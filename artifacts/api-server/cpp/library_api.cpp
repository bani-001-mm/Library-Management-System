#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include <libpq-fe.h>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

namespace {

struct HttpError : std::runtime_error {
  int status;

  HttpError(int code, const std::string& message)
      : std::runtime_error(message), status(code) {}
};

using PgResult = std::unique_ptr<PGresult, decltype(&PQclear)>;

class Database {
 public:
  Database() {
    const char* url = std::getenv("DATABASE_URL");
    if (url == nullptr || *url == '\0') {
      throw std::runtime_error("DATABASE_URL is not configured");
    }

    connection_ = PQconnectdb(url);
    if (connection_ == nullptr ||
        PQstatus(connection_) != CONNECTION_OK) {
      const std::string message =
          connection_ == nullptr ? "Could not connect to the database"
                                 : PQerrorMessage(connection_);
      if (connection_ != nullptr) {
        PQfinish(connection_);
        connection_ = nullptr;
      }
      throw std::runtime_error(message);
    }
  }

  ~Database() {
    if (connection_ != nullptr) {
      PQfinish(connection_);
    }
  }

  PgResult query(const std::string& sql,
                 const std::vector<std::string>& values = {}) {
    std::vector<const char*> parameters;
    parameters.reserve(values.size());
    for (const auto& value : values) {
      parameters.push_back(value.c_str());
    }

    PGresult* result = PQexecParams(
        connection_, sql.c_str(), static_cast<int>(parameters.size()), nullptr,
        parameters.empty() ? nullptr : parameters.data(), nullptr, nullptr, 0);

    if (result == nullptr) {
      throw std::runtime_error(PQerrorMessage(connection_));
    }

    const auto status = PQresultStatus(result);
    if (status != PGRES_TUPLES_OK && status != PGRES_COMMAND_OK) {
      const char* state = PQresultErrorField(result, PG_DIAG_SQLSTATE);
      const std::string detail = PQresultErrorMessage(result);
      const int httpStatus =
          state != nullptr && std::strcmp(state, "23505") == 0 ? 409 : 500;
      PQclear(result);
      if (httpStatus == 409) {
        throw HttpError(409, "That ISBN or email address is already in use.");
      }
      throw std::runtime_error(detail);
    }

    return PgResult(result, &PQclear);
  }

 private:
  PGconn* connection_ = nullptr;
};

struct Request {
  std::string method;
  std::string target;
  std::string path;
  std::string body;
};

std::string lower(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(),
                 [](unsigned char character) {
                   return static_cast<char>(std::tolower(character));
                 });
  return value;
}

std::string decodeUrl(const std::string& input) {
  std::string output;
  output.reserve(input.size());
  for (std::size_t index = 0; index < input.size(); ++index) {
    if (input[index] == '+' ) {
      output.push_back(' ');
    } else if (input[index] == '%' && index + 2 < input.size()) {
      const std::string hex = input.substr(index + 1, 2);
      char* end = nullptr;
      const long value = std::strtol(hex.c_str(), &end, 16);
      if (end != hex.c_str() && *end == '\0') {
        output.push_back(static_cast<char>(value));
        index += 2;
      } else {
        output.push_back(input[index]);
      }
    } else {
      output.push_back(input[index]);
    }
  }
  return output;
}

std::unordered_map<std::string, std::string> parseQuery(
    const std::string& target) {
  std::unordered_map<std::string, std::string> values;
  const auto question = target.find('?');
  if (question == std::string::npos) {
    return values;
  }

  std::istringstream stream(target.substr(question + 1));
  std::string pair;
  while (std::getline(stream, pair, '&')) {
    const auto equals = pair.find('=');
    const auto key = decodeUrl(pair.substr(0, equals));
    const auto value = equals == std::string::npos
                           ? std::string()
                           : decodeUrl(pair.substr(equals + 1));
    values[key] = value;
  }
  return values;
}

std::vector<std::string> pathSegments(const std::string& path) {
  std::vector<std::string> segments;
  std::istringstream stream(path);
  std::string segment;
  while (std::getline(stream, segment, '/')) {
    if (!segment.empty()) {
      segments.push_back(segment);
    }
  }
  return segments;
}

int parseId(const std::string& value) {
  try {
    std::size_t consumed = 0;
    const int id = std::stoi(value, &consumed);
    if (consumed != value.size() || id < 1) {
      throw std::invalid_argument("id");
    }
    return id;
  } catch (...) {
    throw HttpError(400, "The record ID must be a positive number.");
  }
}

std::string requiredText(const json& body, const std::string& key) {
  if (!body.is_object() || !body.contains(key) || !body[key].is_string()) {
    throw HttpError(400, key + " is required.");
  }
  const auto value = body[key].get<std::string>();
  if (value.empty() ||
      std::all_of(value.begin(), value.end(), [](unsigned char character) {
        return std::isspace(character);
      })) {
    throw HttpError(400, key + " cannot be blank.");
  }
  return value;
}

int requiredPositiveInt(const json& body, const std::string& key) {
  if (!body.is_object() || !body.contains(key) ||
      !body[key].is_number_integer()) {
    throw HttpError(400, key + " must be a whole number.");
  }
  const int value = body[key].get<int>();
  if (value < 1) {
    throw HttpError(400, key + " must be at least 1.");
  }
  return value;
}

json parseBody(const std::string& body) {
  try {
    const auto value = json::parse(body);
    if (!value.is_object()) {
      throw HttpError(400, "The request body must be a JSON object.");
    }
    return value;
  } catch (const json::parse_error&) {
    throw HttpError(400, "The request body must contain valid JSON.");
  }
}

std::string cell(PGresult* result, int row, const char* column) {
  const int index = PQfnumber(result, column);
  if (index < 0 || PQgetisnull(result, row, index)) {
    return "";
  }
  return PQgetvalue(result, row, index);
}

int integerCell(PGresult* result, int row, const char* column) {
  const auto value = cell(result, row, column);
  return value.empty() ? 0 : std::stoi(value);
}

json nullableCell(PGresult* result, int row, const char* column) {
  const int index = PQfnumber(result, column);
  if (index < 0 || PQgetisnull(result, row, index)) {
    return nullptr;
  }
  return PQgetvalue(result, row, index);
}

json bookFromRow(PGresult* result, int row) {
  return {
      {"id", integerCell(result, row, "id")},
      {"title", cell(result, row, "title")},
      {"author", cell(result, row, "author")},
      {"isbn", cell(result, row, "isbn")},
      {"category", cell(result, row, "category")},
      {"totalCopies", integerCell(result, row, "total_copies")},
      {"availableCopies", integerCell(result, row, "available_copies")},
      {"createdAt", cell(result, row, "created_at")},
  };
}

json memberFromRow(PGresult* result, int row) {
  return {
      {"id", integerCell(result, row, "id")},
      {"name", cell(result, row, "name")},
      {"email", cell(result, row, "email")},
      {"phone", nullableCell(result, row, "phone")},
      {"joinedAt", cell(result, row, "joined_at")},
      {"activeLoans", integerCell(result, row, "active_loans")},
  };
}

json loanFromRow(PGresult* result, int row) {
  return {
      {"id", integerCell(result, row, "id")},
      {"bookId", integerCell(result, row, "book_id")},
      {"bookTitle", cell(result, row, "book_title")},
      {"memberId", integerCell(result, row, "member_id")},
      {"memberName", cell(result, row, "member_name")},
      {"issuedAt", cell(result, row, "issued_at")},
      {"dueAt", cell(result, row, "due_at")},
      {"returnedAt", nullableCell(result, row, "returned_at")},
      {"status", cell(result, row, "status")},
  };
}

const std::string bookSelect =
    "SELECT b.id, b.title, b.author, b.isbn, b.category, b.total_copies, "
    "(b.total_copies - COUNT(l.id) FILTER (WHERE l.returned_at IS NULL)) "
    "AS available_copies, b.created_at::text AS created_at "
    "FROM books b LEFT JOIN loans l ON l.book_id = b.id ";

const std::string memberSelect =
    "SELECT m.id, m.name, m.email, m.phone, m.joined_at::text AS joined_at, "
    "COUNT(l.id) FILTER (WHERE l.returned_at IS NULL)::int AS active_loans "
    "FROM members m LEFT JOIN loans l ON l.member_id = m.id ";

const std::string loanSelect =
    "SELECT l.id, l.book_id, b.title AS book_title, l.member_id, "
    "m.name AS member_name, l.issued_at::text AS issued_at, "
    "l.due_at::text AS due_at, l.returned_at::text AS returned_at, "
    "CASE WHEN l.returned_at IS NOT NULL THEN 'returned' "
    "WHEN l.due_at < now() THEN 'overdue' ELSE 'active' END AS status "
    "FROM loans l JOIN books b ON b.id = l.book_id "
    "JOIN members m ON m.id = l.member_id ";

json getBook(Database& database, int id) {
  auto result = database.query(bookSelect + "WHERE b.id = $1 GROUP BY b.id",
                               {std::to_string(id)});
  if (PQntuples(result.get()) == 0) {
    throw HttpError(404, "Book not found.");
  }
  return bookFromRow(result.get(), 0);
}

json getMember(Database& database, int id) {
  auto result = database.query(memberSelect +
                               "WHERE m.id = $1 GROUP BY m.id",
                               {std::to_string(id)});
  if (PQntuples(result.get()) == 0) {
    throw HttpError(404, "Member not found.");
  }
  return memberFromRow(result.get(), 0);
}

json getLoan(Database& database, int id) {
  auto result = database.query(loanSelect + "WHERE l.id = $1",
                               {std::to_string(id)});
  if (PQntuples(result.get()) == 0) {
    throw HttpError(404, "Loan not found.");
  }
  return loanFromRow(result.get(), 0);
}

json listBooks(Database& database, const std::string& search) {
  auto result = database.query(
      bookSelect +
          "WHERE ($1 = '' OR b.title ILIKE '%' || $1 || '%' "
          "OR b.author ILIKE '%' || $1 || '%' OR b.isbn ILIKE '%' || $1 || '%' "
          "OR b.category ILIKE '%' || $1 || '%') "
          "GROUP BY b.id ORDER BY b.title",
      {search});
  json books = json::array();
  for (int row = 0; row < PQntuples(result.get()); ++row) {
    books.push_back(bookFromRow(result.get(), row));
  }
  return books;
}

json listMembers(Database& database, const std::string& search) {
  auto result = database.query(
      memberSelect +
          "WHERE ($1 = '' OR m.name ILIKE '%' || $1 || '%' "
          "OR m.email ILIKE '%' || $1 || '%') "
          "GROUP BY m.id ORDER BY m.name",
      {search});
  json members = json::array();
  for (int row = 0; row < PQntuples(result.get()); ++row) {
    members.push_back(memberFromRow(result.get(), row));
  }
  return members;
}

int affectedRows(PGresult* result) {
  const char* count = PQcmdTuples(result);
  return count == nullptr || *count == '\0' ? 0 : std::stoi(count);
}

json createBook(Database& database, const json& body) {
  const auto title = requiredText(body, "title");
  const auto author = requiredText(body, "author");
  const auto isbn = requiredText(body, "isbn");
  const auto category = requiredText(body, "category");
  const auto copies = requiredPositiveInt(body, "totalCopies");
  auto inserted = database.query(
      "INSERT INTO books (title, author, isbn, category, total_copies) "
      "VALUES ($1, $2, $3, $4, $5) RETURNING id",
      {title, author, isbn, category, std::to_string(copies)});
  return getBook(database, integerCell(inserted.get(), 0, "id"));
}

json updateBook(Database& database, int id, const json& body) {
  std::vector<std::string> values;
  std::vector<std::string> assignments;
  auto addText = [&](const char* key, const char* column) {
    if (body.contains(key)) {
      values.push_back(requiredText(body, key));
      assignments.push_back(std::string(column) + " = $" +
                            std::to_string(values.size()));
    }
  };

  addText("title", "title");
  addText("author", "author");
  addText("isbn", "isbn");
  addText("category", "category");
  if (body.contains("totalCopies")) {
    const int copies = requiredPositiveInt(body, "totalCopies");
    auto active = database.query(
        "SELECT COUNT(*)::int AS count FROM loans "
        "WHERE book_id = $1 AND returned_at IS NULL",
        {std::to_string(id)});
    if (copies < integerCell(active.get(), 0, "count")) {
      throw HttpError(409, "Total copies cannot be fewer than copies on loan.");
    }
    values.push_back(std::to_string(copies));
    assignments.push_back("total_copies = $" +
                          std::to_string(values.size()));
  }
  if (assignments.empty()) {
    throw HttpError(400, "Provide at least one field to update.");
  }

  values.push_back(std::to_string(id));
  std::string sql = "UPDATE books SET ";
  for (std::size_t index = 0; index < assignments.size(); ++index) {
    if (index != 0) sql += ", ";
    sql += assignments[index];
  }
  sql += " WHERE id = $" + std::to_string(values.size());
  auto updated = database.query(sql, values);
  if (affectedRows(updated.get()) == 0) {
    throw HttpError(404, "Book not found.");
  }
  return getBook(database, id);
}

void deleteBook(Database& database, int id) {
  auto history = database.query(
      "SELECT COUNT(*)::int AS count FROM loans WHERE book_id = $1",
      {std::to_string(id)});
  auto exists = database.query("SELECT id FROM books WHERE id = $1",
                               {std::to_string(id)});
  if (PQntuples(exists.get()) == 0) {
    throw HttpError(404, "Book not found.");
  }
  if (integerCell(history.get(), 0, "count") > 0) {
    throw HttpError(409,
                    "This book has loan history and cannot be deleted.");
  }
  database.query("DELETE FROM books WHERE id = $1", {std::to_string(id)});
}

json createMember(Database& database, const json& body) {
  const auto name = requiredText(body, "name");
  const auto email = requiredText(body, "email");
  std::string phone;
  if (body.contains("phone") && !body["phone"].is_null()) {
    if (!body["phone"].is_string()) {
      throw HttpError(400, "phone must be text or null.");
    }
    phone = body["phone"].get<std::string>();
  }
  auto inserted = database.query(
      "INSERT INTO members (name, email, phone) VALUES ($1, $2, $3) "
      "RETURNING id",
      {name, email, phone});
  return getMember(database, integerCell(inserted.get(), 0, "id"));
}

json updateMember(Database& database, int id, const json& body) {
  std::vector<std::string> values;
  std::vector<std::string> assignments;
  auto addText = [&](const char* key, const char* column) {
    if (body.contains(key)) {
      values.push_back(requiredText(body, key));
      assignments.push_back(std::string(column) + " = $" +
                            std::to_string(values.size()));
    }
  };

  addText("name", "name");
  addText("email", "email");
  if (body.contains("phone")) {
    if (!body["phone"].is_null() && !body["phone"].is_string()) {
      throw HttpError(400, "phone must be text or null.");
    }
    values.push_back(body["phone"].is_null()
                         ? std::string()
                         : body["phone"].get<std::string>());
    assignments.push_back("phone = $" + std::to_string(values.size()));
  }
  if (assignments.empty()) {
    throw HttpError(400, "Provide at least one field to update.");
  }

  values.push_back(std::to_string(id));
  std::string sql = "UPDATE members SET ";
  for (std::size_t index = 0; index < assignments.size(); ++index) {
    if (index != 0) sql += ", ";
    sql += assignments[index];
  }
  sql += " WHERE id = $" + std::to_string(values.size());
  auto updated = database.query(sql, values);
  if (affectedRows(updated.get()) == 0) {
    throw HttpError(404, "Member not found.");
  }
  return getMember(database, id);
}

void deleteMember(Database& database, int id) {
  auto history = database.query(
      "SELECT COUNT(*)::int AS count FROM loans WHERE member_id = $1",
      {std::to_string(id)});
  auto exists = database.query("SELECT id FROM members WHERE id = $1",
                               {std::to_string(id)});
  if (PQntuples(exists.get()) == 0) {
    throw HttpError(404, "Member not found.");
  }
  if (integerCell(history.get(), 0, "count") > 0) {
    throw HttpError(409,
                    "This member has loan history and cannot be deleted.");
  }
  database.query("DELETE FROM members WHERE id = $1", {std::to_string(id)});
}

json listLoans(Database& database, const std::string& status) {
  if (status != "all" && status != "active" && status != "returned" &&
      status != "overdue") {
    throw HttpError(400, "status must be active, returned, overdue, or all.");
  }
  auto result = database.query(
      loanSelect +
          "WHERE ($1 = 'all' "
          "OR ($1 = 'returned' AND l.returned_at IS NOT NULL) "
          "OR ($1 = 'active' AND l.returned_at IS NULL AND l.due_at >= now()) "
          "OR ($1 = 'overdue' AND l.returned_at IS NULL AND l.due_at < now())) "
          "ORDER BY l.issued_at DESC",
      {status});
  json loans = json::array();
  for (int row = 0; row < PQntuples(result.get()); ++row) {
    loans.push_back(loanFromRow(result.get(), row));
  }
  return loans;
}

json issueLoan(Database& database, const json& body) {
  const int bookId = requiredPositiveInt(body, "bookId");
  const int memberId = requiredPositiveInt(body, "memberId");

  database.query("BEGIN");
  try {
    auto book = database.query(
        "SELECT total_copies FROM books WHERE id = $1 FOR UPDATE",
        {std::to_string(bookId)});
    if (PQntuples(book.get()) == 0) {
      throw HttpError(404, "Book not found.");
    }
    auto member = database.query("SELECT id FROM members WHERE id = $1",
                                 {std::to_string(memberId)});
    if (PQntuples(member.get()) == 0) {
      throw HttpError(404, "Member not found.");
    }
    auto active = database.query(
        "SELECT COUNT(*)::int AS count FROM loans "
        "WHERE book_id = $1 AND returned_at IS NULL",
        {std::to_string(bookId)});
    if (integerCell(active.get(), 0, "count") >=
        integerCell(book.get(), 0, "total_copies")) {
      throw HttpError(409, "No copies of this book are currently available.");
    }
    auto inserted = database.query(
        "INSERT INTO loans (book_id, member_id) VALUES ($1, $2) RETURNING id",
        {std::to_string(bookId), std::to_string(memberId)});
    const int loanId = integerCell(inserted.get(), 0, "id");
    database.query("COMMIT");
    return getLoan(database, loanId);
  } catch (...) {
    try {
      database.query("ROLLBACK");
    } catch (...) {
    }
    throw;
  }
}

json returnLoan(Database& database, int id) {
  auto updated = database.query(
      "UPDATE loans SET returned_at = now() "
      "WHERE id = $1 AND returned_at IS NULL RETURNING id",
      {std::to_string(id)});
  if (PQntuples(updated.get()) == 0) {
    auto exists = database.query("SELECT id FROM loans WHERE id = $1",
                                 {std::to_string(id)});
    if (PQntuples(exists.get()) == 0) {
      throw HttpError(404, "Loan not found.");
    }
    throw HttpError(409, "This book has already been returned.");
  }
  return getLoan(database, id);
}

json dashboard(Database& database) {
  auto result = database.query(
      "SELECT "
      "(SELECT COUNT(*)::int FROM books) AS total_books, "
      "COALESCE((SELECT SUM(total_copies)::int FROM books), 0) AS total_copies, "
      "COALESCE((SELECT SUM(b.total_copies - "
      "(SELECT COUNT(*) FROM loans l WHERE l.book_id = b.id "
      "AND l.returned_at IS NULL))::int FROM books b), 0) AS available_copies, "
      "(SELECT COUNT(*)::int FROM members) AS total_members, "
      "(SELECT COUNT(*)::int FROM loans WHERE returned_at IS NULL) AS active_loans, "
      "(SELECT COUNT(*)::int FROM loans WHERE returned_at IS NULL "
      "AND due_at < now()) AS overdue_loans");
  return {
      {"totalBooks", integerCell(result.get(), 0, "total_books")},
      {"totalCopies", integerCell(result.get(), 0, "total_copies")},
      {"availableCopies", integerCell(result.get(), 0, "available_copies")},
      {"totalMembers", integerCell(result.get(), 0, "total_members")},
      {"activeLoans", integerCell(result.get(), 0, "active_loans")},
      {"overdueLoans", integerCell(result.get(), 0, "overdue_loans")},
  };
}

json activity(Database& database) {
  auto result = database.query(
      "SELECT id, kind, book_title, member_name, occurred_at::text AS occurred_at "
      "FROM ("
      "SELECT l.id, 'issued'::text AS kind, b.title AS book_title, "
      "m.name AS member_name, l.issued_at AS occurred_at "
      "FROM loans l JOIN books b ON b.id = l.book_id "
      "JOIN members m ON m.id = l.member_id "
      "UNION ALL "
      "SELECT l.id, 'returned'::text AS kind, b.title AS book_title, "
      "m.name AS member_name, l.returned_at AS occurred_at "
      "FROM loans l JOIN books b ON b.id = l.book_id "
      "JOIN members m ON m.id = l.member_id WHERE l.returned_at IS NOT NULL"
      ") events ORDER BY occurred_at DESC LIMIT 10");
  json items = json::array();
  for (int row = 0; row < PQntuples(result.get()); ++row) {
    items.push_back({
        {"id", integerCell(result.get(), row, "id")},
        {"kind", cell(result.get(), row, "kind")},
        {"bookTitle", cell(result.get(), row, "book_title")},
        {"memberName", cell(result.get(), row, "member_name")},
        {"occurredAt", cell(result.get(), row, "occurred_at")},
    });
  }
  return items;
}

json route(const Request& request, int& status) {
  if (request.method == "OPTIONS") {
    status = 204;
    return nullptr;
  }

  const auto segments = pathSegments(request.path);
  if (segments.size() < 2 || segments[0] != "api") {
    throw HttpError(404, "API route not found.");
  }
  auto query = parseQuery(request.target);
  Database database;

  if (segments.size() == 2 && segments[1] == "healthz" &&
      request.method == "GET") {
    database.query("SELECT 1");
    return {{"status", "ok"}};
  }
  if (segments.size() == 2 && segments[1] == "dashboard" &&
      request.method == "GET") {
    return dashboard(database);
  }
  if (segments.size() == 2 && segments[1] == "activity" &&
      request.method == "GET") {
    return activity(database);
  }
  if (segments.size() == 2 && segments[1] == "books") {
    if (request.method == "GET") {
      return listBooks(database, query["search"]);
    }
    if (request.method == "POST") {
      status = 201;
      return createBook(database, parseBody(request.body));
    }
  }
  if (segments.size() == 3 && segments[1] == "books") {
    const int id = parseId(segments[2]);
    if (request.method == "PATCH") {
      return updateBook(database, id, parseBody(request.body));
    }
    if (request.method == "DELETE") {
      deleteBook(database, id);
      status = 204;
      return nullptr;
    }
  }
  if (segments.size() == 2 && segments[1] == "members") {
    if (request.method == "GET") {
      return listMembers(database, query["search"]);
    }
    if (request.method == "POST") {
      status = 201;
      return createMember(database, parseBody(request.body));
    }
  }
  if (segments.size() == 3 && segments[1] == "members") {
    const int id = parseId(segments[2]);
    if (request.method == "PATCH") {
      return updateMember(database, id, parseBody(request.body));
    }
    if (request.method == "DELETE") {
      deleteMember(database, id);
      status = 204;
      return nullptr;
    }
  }
  if (segments.size() == 2 && segments[1] == "loans") {
    if (request.method == "GET") {
      const auto statusIt = query.find("status");
      return listLoans(database, statusIt == query.end() ? "all"
                                                         : statusIt->second);
    }
    if (request.method == "POST") {
      status = 201;
      return issueLoan(database, parseBody(request.body));
    }
  }
  if (segments.size() == 4 && segments[1] == "loans" &&
      segments[3] == "return" && request.method == "POST") {
    return returnLoan(database, parseId(segments[2]));
  }
  throw HttpError(404, "API route not found.");
}

std::string reasonPhrase(int status) {
  switch (status) {
    case 200: return "OK";
    case 201: return "Created";
    case 204: return "No Content";
    case 400: return "Bad Request";
    case 404: return "Not Found";
    case 409: return "Conflict";
    default: return "Internal Server Error";
  }
}

void sendAll(int socket, const std::string& data) {
  std::size_t sent = 0;
  while (sent < data.size()) {
    const auto count = send(socket, data.data() + sent, data.size() - sent,
                            MSG_NOSIGNAL);
    if (count <= 0) return;
    sent += static_cast<std::size_t>(count);
  }
}

void respond(int socket, int status, const json& body) {
  const std::string content = status == 204 ? "" : body.dump();
  const std::string response =
      "HTTP/1.1 " + std::to_string(status) + " " + reasonPhrase(status) +
      "\r\nContent-Type: application/json; charset=utf-8\r\n"
      "Access-Control-Allow-Origin: *\r\n"
      "Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS\r\n"
      "Access-Control-Allow-Headers: Content-Type\r\n"
      "Connection: close\r\nContent-Length: " +
      std::to_string(content.size()) + "\r\n\r\n" + content;
  sendAll(socket, response);
}

Request readRequest(int socket) {
  std::string buffer;
  char chunk[4096];
  auto headerEnd = std::string::npos;

  while ((headerEnd = buffer.find("\r\n\r\n")) == std::string::npos) {
    const auto count = recv(socket, chunk, sizeof(chunk), 0);
    if (count <= 0) throw HttpError(400, "Could not read the HTTP request.");
    buffer.append(chunk, static_cast<std::size_t>(count));
    if (buffer.size() > 1024 * 1024) {
      throw HttpError(400, "The request is too large.");
    }
  }

  const std::string headers = buffer.substr(0, headerEnd);
  std::istringstream lines(headers);
  Request request;
  std::string firstLine;
  std::getline(lines, firstLine);
  std::istringstream requestLine(firstLine);
  requestLine >> request.method >> request.target;
  request.method = lower(request.method);
  std::transform(request.method.begin(), request.method.end(),
                 request.method.begin(), [](unsigned char character) {
                   return static_cast<char>(std::toupper(character));
                 });

  std::size_t contentLength = 0;
  std::string line;
  while (std::getline(lines, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    const auto colon = line.find(':');
    if (colon != std::string::npos &&
        lower(line.substr(0, colon)) == "content-length") {
      contentLength = static_cast<std::size_t>(
          std::strtoull(line.substr(colon + 1).c_str(), nullptr, 10));
    }
  }
  if (contentLength > 1024 * 1024) {
    throw HttpError(400, "The request is too large.");
  }

  const auto question = request.target.find('?');
  request.path = request.target.substr(0, question);
  request.body = buffer.substr(headerEnd + 4);
  while (request.body.size() < contentLength) {
    const auto count = recv(socket, chunk, sizeof(chunk), 0);
    if (count <= 0) throw HttpError(400, "The request body is incomplete.");
    request.body.append(chunk, static_cast<std::size_t>(count));
  }
  request.body.resize(contentLength);
  return request;
}

void handleConnection(int socket) {
  try {
    const auto request = readRequest(socket);
    int status = 200;
    const auto result = route(request, status);
    respond(socket, status, result);
  } catch (const HttpError& error) {
    respond(socket, error.status, {{"error", error.what()}});
  } catch (const std::exception& error) {
    std::cerr << "Library API error: " << error.what() << '\n';
    respond(socket, 500, {{"error", "The server could not complete the request."}});
  }
  close(socket);
}

}  // namespace

int main() {
  const char* rawPort = std::getenv("PORT");
  if (rawPort == nullptr) {
    std::cerr << "PORT is not configured\n";
    return 1;
  }

  const int port = std::stoi(rawPort);
  const int server = socket(AF_INET, SOCK_STREAM, 0);
  if (server < 0) {
    std::cerr << "Could not create the API server socket\n";
    return 1;
  }

  int reuseAddress = 1;
  setsockopt(server, SOL_SOCKET, SO_REUSEADDR, &reuseAddress,
             sizeof(reuseAddress));
  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = INADDR_ANY;
  address.sin_port = htons(static_cast<uint16_t>(port));

  if (bind(server, reinterpret_cast<sockaddr*>(&address), sizeof(address)) < 0 ||
      listen(server, 64) < 0) {
    std::cerr << "Could not start the API server on port " << port << '\n';
    close(server);
    return 1;
  }

  std::cerr << "C++ library API listening on port " << port << '\n';
  while (true) {
    const int client = accept(server, nullptr, nullptr);
    if (client >= 0) {
      std::thread(handleConnection, client).detach();
    }
  }
}