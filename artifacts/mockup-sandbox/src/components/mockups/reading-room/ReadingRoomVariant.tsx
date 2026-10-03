import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, BookOpen, Check,
  ChevronRight, Clock3, LayoutDashboard, Menu, Plus, Search, UsersRound, X,
} from "lucide-react";
import "./ReadingRoomVariant.css";

type LoanItem = {
  id: number;
  title: string;
  author: string;
  reader: string;
  due: string;
  overdue?: boolean;
  tone: "sage" | "ochre" | "rose" | "blue";
  returned?: boolean;
};

const starterLoans: LoanItem[] = [
  { id: 1, title: "The Overstory", author: "Richard Powers", reader: "Elena Ruiz", due: "Mar 24", tone: "sage" },
  { id: 2, title: "Piranesi", author: "Susanna Clarke", reader: "David Kim", due: "Mar 25", tone: "ochre" },
  { id: 3, title: "Braiding Sweetgrass", author: "Robin Wall Kimmerer", reader: "Simone Park", due: "Mar 18", overdue: true, tone: "rose" },
];

const deskActivity = [
  { kind: "issued", person: "Elena Ruiz", action: "borrowed", book: "The Overstory", time: "12 min ago" },
  { kind: "returned", person: "Marcus Bell", action: "returned", book: "Small Things Like These", time: "38 min ago" },
  { kind: "issued", person: "David Kim", action: "borrowed", book: "Piranesi", time: "1 hour ago" },
  { kind: "returned", person: "Nora Patel", action: "returned", book: "Sea of Tranquility", time: "2 hours ago" },
];

const navigation = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Books", icon: BookOpen },
  { label: "Members", icon: UsersRound },
  { label: "Loans & returns", icon: ArrowUpRight },
];

export function ReadingRoomVariant() {
  const [activeNav, setActiveNav] = useState("Overview");
  const [loans, setLoans] = useState(starterLoans);
  const [loanCount, setLoanCount] = useState(18);
  const [overdueCount, setOverdueCount] = useState(2);
  const [issueOpen, setIssueOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [bookTitle, setBookTitle] = useState("The Left Hand of Darkness");
  const [readerName, setReaderName] = useState("Morgan Chen");

  useEffect(() => {
    if (!issueOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIssueOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [issueOpen]);

  const visibleLoans = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return loans.filter((loan) => !query || `${loan.title} ${loan.author} ${loan.reader}`.toLowerCase().includes(query));
  }, [loans, searchText]);

  const returnLoan = (loan: LoanItem) => {
    if (loan.returned) return;
    setLoans((current) => current.map((item) => item.id === loan.id ? { ...item, returned: true } : item));
    setLoanCount((count) => Math.max(0, count - 1));
    if (loan.overdue) setOverdueCount((count) => Math.max(0, count - 1));
  };

  const issueLoan = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = bookTitle.trim();
    const reader = readerName.trim();
    if (!title || !reader) return;
    setLoans((current) => [
      { id: Date.now(), title, author: "New checkout", reader, due: "Apr 04", tone: "blue" },
      ...current,
    ]);
    setLoanCount((count) => count + 1);
    setIssueOpen(false);
  };

  return (
    <div className="rr-app">
      <header className="rr-header">
        <div className="rr-brand">
          <span className="rr-brand-mark"><BookOpen size={21} strokeWidth={1.7} /></span>
          <span className="rr-brand-type"><b>Margin</b><small>WILLOW CREEK LIBRARY</small></span>
        </div>
        <nav className="rr-nav" aria-label="Main navigation">
          {navigation.map(({ label, icon: Icon }) => (
            <button
              key={label}
              className={`rr-nav-item ${activeNav === label ? "is-active" : ""}`}
              onClick={() => setActiveNav(label)}
              aria-current={activeNav === label ? "page" : undefined}
            >
              <Icon size={15} strokeWidth={1.8} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="rr-header-right">
          <span className="rr-open-status"><i />Open until 6 pm</span>
          <span className="rr-header-rule" />
          <span className="rr-staff-avatar">MC</span>
          <span className="rr-staff-name">Morgan Chen</span>
          <button className="rr-mobile-menu" onClick={() => setActiveNav(activeNav === "Overview" ? "Books" : "Overview")} aria-label="Toggle navigation"><Menu size={18} /></button>
        </div>
      </header>

      <main className="rr-main">
        <section className="rr-intro">
          <div>
            <div className="rr-kicker"><span>THE READING ROOM</span><i />THURSDAY, MARCH 21</div>
            <h1>A good day <em>to read.</em></h1>
            <p>Here’s what’s happening around your library.</p>
          </div>
          <div className="rr-intro-actions">
            <button className="rr-quiet-action" onClick={() => setSearchOpen((open) => !open)} aria-label="Search active loans">
              {searchOpen ? <X size={17} /> : <Search size={17} />}
            </button>
            <button className="rr-issue-button" onClick={() => setIssueOpen(true)}><Plus size={16} />Issue a book</button>
          </div>
        </section>

        {searchOpen && (
          <label className="rr-search-bar">
            <Search size={16} />
            <input autoFocus value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Find a book or reader in the lending desk…" />
            {searchText && <button onClick={() => setSearchText("")} aria-label="Clear search"><X size={15} /></button>}
          </label>
        )}

        <section className="rr-today" aria-label="Library at a glance">
          <div className="rr-today-heading">
            <span className="rr-today-seal"><BookOpen size={18} /></span>
            <span>YOUR LIBRARY, TODAY</span>
            <span className="rr-today-date"><Clock3 size={13} /> AT A GLANCE</span>
          </div>
          <div className="rr-stat-strip">
            <div className="rr-stat rr-stat-feature">
              <span>IN THE CATALOGUE</span><strong>864</strong><small>1,286 copies on shelves</small>
            </div>
            <div className="rr-stat">
              <span>READERS</span><strong>327</strong><small>registered members</small>
            </div>
            <div className="rr-stat">
              <span>OUT ON LOAN</span><strong>{loanCount}</strong><small>books with readers</small>
            </div>
            <div className={`rr-stat rr-stat-alert ${overdueCount ? "has-overdue" : ""}`}>
              <span>NEEDS ATTENTION</span><strong>{overdueCount}</strong><small>{overdueCount ? "overdue returns" : "all books accounted for"}</small>
            </div>
          </div>
          <div className="rr-availability">
            <span className="rr-availability-mark"><Check size={15} /></span>
            <b>1,104 copies ready to go</b>
            <span>Available for your next reader.</span>
            <button onClick={() => setActiveNav("Books")}>Browse catalogue <ArrowRight size={14} /></button>
          </div>
        </section>

        <div className="rr-workspace">
          <section className="rr-loans">
            <div className="rr-section-head">
              <div>
                <div className="rr-section-kicker">KEEP AN EYE ON <span>·</span> LENDING DESK</div>
                <h2>Currently borrowed</h2>
                <p>Showing {visibleLoans.filter((loan) => !loan.returned).length} of {loanCount} books out in the community.</p>
              </div>
              <button className="rr-all-link" onClick={() => setActiveNav("Loans & returns")}>All loans <ChevronRight size={15} /></button>
            </div>
            <div className="rr-loan-list">
              {visibleLoans.map((loan, index) => (
                <article className={`rr-loan-row ${loan.returned ? "is-returned" : ""}`} key={loan.id}>
                  <span className={`rr-book-cover cover-${loan.tone}`} aria-hidden="true">
                    <span className="rr-cover-line" />
                    <BookOpen size={18} strokeWidth={1.5} />
                  </span>
                  <div className="rr-book-copy">
                    <span className="rr-row-index">0{index + 1} <i /></span>
                    <h3>{loan.title}</h3>
                    <p>{loan.author}</p>
                  </div>
                  <div className="rr-borrower">
                    <span>WITH READER</span>
                    <b><i>{loan.reader.split(" ").map((part) => part[0]).join("").slice(0, 2)}</i>{loan.reader}</b>
                  </div>
                  <div className={`rr-due ${loan.overdue && !loan.returned ? "is-overdue" : ""}`}>
                    <span>{loan.returned ? "STATUS" : loan.overdue ? "PAST DUE" : "DUE BACK"}</span>
                    <b>{loan.returned ? "Returned" : loan.overdue ? `${loan.due} · 3 days overdue` : loan.due}</b>
                  </div>
                  <button className={`rr-return ${loan.returned ? "returned" : ""}`} onClick={() => returnLoan(loan)} disabled={loan.returned}>
                    {loan.returned ? <><Check size={14} />Returned</> : <><ArrowDownLeft size={14} />Return</>}
                  </button>
                </article>
              ))}
              {!visibleLoans.length && <div className="rr-empty"><Search size={18} /><b>No matching loans</b><span>Try another book title or reader.</span></div>}
            </div>
            <div className="rr-loan-foot"><span><BookOpen size={14} /> {loanCount} active loans in the register</span><button onClick={() => setActiveNav("Loans & returns")}>Open lending register <ArrowRight size={14} /></button></div>
          </section>

          <aside className="rr-activity">
            <div className="rr-activity-head">
              <div><div className="rr-section-kicker">THE DESK LOG</div><h2>Recent activity</h2></div>
              <span className="rr-activity-icon"><Activity size={17} /></span>
            </div>
            <div className="rr-timeline">
              {deskActivity.map((entry, index) => (
                <div className="rr-activity-item" key={`${entry.person}-${entry.book}`}>
                  <span className={`rr-activity-symbol ${entry.kind}`}><i>{entry.kind === "issued" ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}</i></span>
                  <div className="rr-activity-copy">
                    <div><b>{entry.person}</b> <span>{entry.action}</span></div>
                    <p>{entry.book}</p><time>{entry.time}</time>
                  </div>
                  {index === 0 && <i className="rr-new-marker" />}
                </div>
              ))}
            </div>
            <button className="rr-activity-link" onClick={() => setActiveNav("Loans & returns")}>View lending activity <ArrowRight size={14} /></button>
            <div className="rr-desk-quote">
              <span className="rr-quote-rule" />
              <p>“A library is not a luxury but one of the necessities of life.”</p>
              <small>HENRY WARD BEECHER</small>
            </div>
          </aside>
        </div>

        <footer className="rr-footer">
          <span><span className="rr-footer-dot" />Library service online</span>
          <span>WILLOW CREEK <i>·</i> A PLACE FOR EVERY STORY</span>
        </footer>
      </main>

      {issueOpen && (
        <div className="rr-modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setIssueOpen(false); }}>
          <section className="rr-modal" role="dialog" aria-modal="true" aria-labelledby="rr-modal-title">
            <div className="rr-modal-head">
              <div><span className="rr-section-kicker">LENDING DESK</span><h2 id="rr-modal-title">Issue a book</h2></div>
              <button onClick={() => setIssueOpen(false)} aria-label="Close"><X size={18} /></button>
            </div>
            <p className="rr-modal-intro">Choose a title and the reader taking it home.</p>
            <form onSubmit={issueLoan}>
              <label>BOOK TO ISSUE<input value={bookTitle} onChange={(event) => setBookTitle(event.target.value)} required /></label>
              <label>READER<input value={readerName} onChange={(event) => setReaderName(event.target.value)} required /></label>
              <div className="rr-modal-note"><Clock3 size={14} /> The standard loan period is set by your library policy.</div>
              <div className="rr-modal-actions"><button type="button" onClick={() => setIssueOpen(false)}>Cancel</button><button type="submit"><ArrowUpRight size={15} />Issue book</button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

export default ReadingRoomVariant;