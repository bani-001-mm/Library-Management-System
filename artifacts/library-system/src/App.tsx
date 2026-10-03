import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation } from 'wouter';
import { useForm } from 'react-hook-form';
import { Form } from '@/components/ui/form';
import {
  Activity, ArrowDownLeft, ArrowUpRight, BookOpen, Check, CircleAlert,
  Clock3, LayoutDashboard, LibraryBig, LoaderCircle, Menu, Plus, Search,
  UsersRound, X, Pencil, Trash2, RotateCcw, CalendarDays, ArrowRight, BadgeCheck,
} from 'lucide-react';
import {
  useHealthCheck, useGetDashboard, useGetBooks, useCreateBook, useUpdateBook,
  useDeleteBook, useGetMembers, useCreateMember, useUpdateMember, useDeleteMember,
  useGetLoans, useIssueLoan, useReturnLoan, useGetActivity,
  getGetDashboardQueryKey, getGetBooksQueryKey, getGetMembersQueryKey,
  getGetLoansQueryKey, getGetActivityQueryKey,
  type Book, type Member, type Loan, type BookInput, type MemberInput,
} from '@workspace/api-client-react';
import NotFound from '@/pages/not-found';
import './index.css';
import './reading-room.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15000, retry: 1 } } });
const navItems = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/books', label: 'Books', icon: BookOpen },
  { href: '/members', label: 'Members', icon: UsersRound },
  { href: '/loans', label: 'Loans & returns', icon: ArrowUpRight },
];
type FormKind = 'book' | 'member' | 'loan';
type FormRecord = Book | Member | undefined;

function dateLabel(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
function timeAgo(value: string) {
  const mins = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return dateLabel(value);
}
function serverError(error: unknown) {
  if (!error) return '';
  const err = error as { message?: string; status?: number; response?: { data?: { message?: string; error?: string } } };
  return err.response?.data?.message || err.response?.data?.error || err.message || 'Something went wrong. Please try again.';
}
function PageLoading() {
  return <div className="loading-list"><div className="skeleton skeleton-title" /><div className="skeleton skeleton-line" /><div className="skeleton skeleton-block" /><div className="skeleton skeleton-block" /></div>;
}
function QueryError({ onRetry }: { onRetry: () => void }) {
  return <div className="empty-state error-state"><div className="empty-icon"><CircleAlert size={21} /></div><h3>We couldn’t load this view</h3><p>Check your connection, then try again.</p><button className="button button-secondary" onClick={onRetry} data-testid="button-retry"><RotateCcw size={15} /> Try again</button></div>;
}
function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><LibraryBig size={21} /></div><h3>{title}</h3><p>{detail}</p>{action}</div>;
}
function StatusPill({ status }: { status: string }) {
  const text = status === 'active' ? 'On loan' : status === 'returned' ? 'Returned' : 'Overdue';
  return <span className={`status-pill status-${status}`}><i />{text}</span>;
}
function TopBar({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return <header className="page-header"><div><div className="eyebrow">THE READING ROOM <span>·</span> {new Date().toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}</div><h1>{title}</h1><p>{subtitle}</p></div>{action}</header>;
}

function Overlay({ children, close }: { children: ReactNode; close: () => void }) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [close]);
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}><section className="modal-card" role="dialog" aria-modal="true">{children}</section></div>;
}

function Editor({ kind, record, onClose, onSaved }: { kind: FormKind; record?: FormRecord; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const editing = !!record && kind !== 'loan';
  const [localError, setLocalError] = useState('');
  const bookMutation = useCreateBook();
  const updateBook = useUpdateBook();
  const memberMutation = useCreateMember();
  const updateMember = useUpdateMember();
  const issueMutation = useIssueLoan();
  const bookList = useGetBooks();
  const memberList = useGetMembers();
  const form = useForm<any>({
    defaultValues: kind === 'book'
      ? { title: (record as Book)?.title || '', author: (record as Book)?.author || '', isbn: (record as Book)?.isbn || '', category: (record as Book)?.category || '', totalCopies: (record as Book)?.totalCopies || 1 }
      : kind === 'member'
        ? { name: (record as Member)?.name || '', email: (record as Member)?.email || '', phone: (record as Member)?.phone || '' }
        : { bookId: '', memberId: '' },
  });
  const busy = bookMutation.isPending || updateBook.isPending || memberMutation.isPending || updateMember.isPending || issueMutation.isPending;
  const title = kind === 'book' ? (editing ? 'Edit book details' : 'Add a book') : kind === 'member' ? (editing ? 'Edit member details' : 'Register a member') : 'Issue a book';
  const submit = form.handleSubmit(async (values) => {
    setLocalError('');
    try {
      if (kind === 'book') {
        const data = { ...values, totalCopies: Number(values.totalCopies) } as BookInput;
        if (editing) await updateBook.mutateAsync({ bookId: (record as Book).id, data });
        else await bookMutation.mutateAsync({ data });
        await Promise.all([qc.invalidateQueries({ queryKey: getGetBooksQueryKey() }), qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() })]);
      } else if (kind === 'member') {
        const data = { name: values.name, email: values.email, phone: values.phone || null } as MemberInput;
        if (editing) await updateMember.mutateAsync({ memberId: (record as Member).id, data });
        else await memberMutation.mutateAsync({ data });
        await Promise.all([qc.invalidateQueries({ queryKey: getGetMembersQueryKey() }), qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() })]);
      } else {
        await issueMutation.mutateAsync({ data: { bookId: Number(values.bookId), memberId: Number(values.memberId) } });
        await Promise.all([qc.invalidateQueries({ queryKey: getGetLoansQueryKey() }), qc.invalidateQueries({ queryKey: getGetBooksQueryKey() }), qc.invalidateQueries({ queryKey: getGetMembersQueryKey() }), qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }), qc.invalidateQueries({ queryKey: getGetActivityQueryKey() })]);
      }
      onSaved();
    } catch (error) { setLocalError(serverError(error)); }
  });
  const inputProps = (name: string, label: string, options: { required?: boolean; type?: string; placeholder?: string; min?: number } = {}) => (
    <label className="field" key={name}><span>{label}</span><input data-testid={`input-${name}`} type={options.type || 'text'} placeholder={options.placeholder} min={options.min} {...form.register(name, { required: options.required ? `${label} is required` : false, ...(options.type === 'number' ? { min: { value: 1, message: 'Enter at least 1' }, valueAsNumber: true } : {}) })} /><small className="field-error">{String((form.formState.errors as any)[name]?.message || '')}</small></label>
  );
  return <Overlay close={onClose}><div className="modal-top"><div><div className="eyebrow">LIBRARY DESK</div><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close" data-testid="button-close-modal"><X size={18} /></button></div>
    <p className="modal-intro">{kind === 'book' ? 'Keep the catalogue accurate and ready for readers.' : kind === 'member' ? 'A few details are all we need to welcome a new reader.' : 'Choose an available copy and the reader taking it home.'}</p>
    {localError && <div className="form-error"><CircleAlert size={16} />{localError}</div>}
    <Form {...form}><form onSubmit={submit} className="editor-form">
      {kind === 'book' && <>{inputProps('title', 'Book title', { required: true, placeholder: 'e.g. The Overstory' })}{inputProps('author', 'Author', { required: true, placeholder: 'e.g. Richard Powers' })}<div className="field-grid">{inputProps('isbn', 'ISBN', { required: true, placeholder: '978…' })}{inputProps('category', 'Category', { required: true, placeholder: 'Fiction' })}</div>{inputProps('totalCopies', 'Total copies', { required: true, type: 'number', min: 1 })}</>}
      {kind === 'member' && <>{inputProps('name', 'Full name', { required: true, placeholder: 'Reader name' })}{inputProps('email', 'Email address', { required: true, type: 'email', placeholder: 'reader@email.com' })}{inputProps('phone', 'Phone number', { placeholder: 'Optional' })}</>}
      {kind === 'loan' && <><label className="field"><span>Book to issue</span><select data-testid="select-loan-book" {...form.register('bookId', { required: 'Choose a book' })}><option value="">Select an available book</option>{(bookList.data || []).filter((book) => book.availableCopies > 0).map((book) => <option key={book.id} value={book.id}>{book.title} · {book.availableCopies} available</option>)}</select><small className="field-error">{String((form.formState.errors as any).bookId?.message || '')}</small></label><label className="field"><span>Reader</span><select data-testid="select-loan-member" {...form.register('memberId', { required: 'Choose a member' })}><option value="">Select a member</option>{(memberList.data || []).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select><small className="field-error">{String((form.formState.errors as any).memberId?.message || '')}</small></label><div className="notice-line"><Clock3 size={15} /> The standard loan period is set by your library policy.</div></>}
      <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose} data-testid="button-cancel">Cancel</button><button type="submit" className="button button-primary" disabled={busy} data-testid="button-save">{busy ? <LoaderCircle className="spin" size={16} /> : kind === 'loan' ? <ArrowUpRight size={16} /> : <Check size={16} />}{busy ? 'Saving…' : kind === 'loan' ? 'Issue book' : editing ? 'Save changes' : kind === 'book' ? 'Add to catalogue' : 'Register member'}</button></div>
    </form></Form>
  </Overlay>;
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const health = useHealthCheck();
  const [mobileNav, setMobileNav] = useState(false);
  return <div className="rr-app">
    <header className="rr-header">
      <Link href="/" className="rr-brand" onClick={() => setMobileNav(false)} aria-label="Margin library overview">
        <span className="rr-brand-mark"><BookOpen size={21} strokeWidth={1.7} /></span>
        <span className="rr-brand-type"><b>Margin</b><small>WILLOW CREEK LIBRARY</small></span>
      </Link>
      <nav className={`rr-nav ${mobileNav ? 'rr-nav-open' : ''}`} aria-label="Main navigation">
        {navItems.map(({ href, label, icon: Icon }) => <Link
          href={href}
          key={href}
          onClick={() => setMobileNav(false)}
          className={`rr-nav-item ${location === href ? 'is-active' : ''}`}
          aria-current={location === href ? 'page' : undefined}
          data-testid={`link-${label.toLowerCase().replaceAll(' ', '-')}`}
        ><Icon size={15} strokeWidth={1.8} /><span>{label}</span></Link>)}
      </nav>
      <div className="rr-header-right">
        <span className="rr-open-status" aria-live="polite">
          <i className={health.data?.status === 'ok' ? 'is-online' : health.isError ? 'is-offline' : ''} />
          {health.isLoading ? 'Checking library service' : health.isError ? 'Library service unavailable' : 'Library service online'}
        </span>
        <span className="rr-header-rule" />
        <span className="rr-staff-avatar">MC</span>
        <span className="rr-staff-name">Morgan Chen</span>
        <button className="rr-mobile-menu" onClick={() => setMobileNav((open) => !open)} aria-label={mobileNav ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileNav}><Menu size={18} /></button>
      </div>
    </header>
    <main className="rr-main">
      {children}
      <footer className="rr-footer">
        <span><span className="rr-footer-dot" />{health.data?.status === 'ok' ? 'Library service online' : 'Willow Creek library desk'}</span>
        <span>WILLOW CREEK <i>·</i> A PLACE FOR EVERY STORY</span>
      </footer>
    </main>
  </div>;
}

function Overview() {
  const summary = useGetDashboard();
  const activity = useGetActivity();
  const loans = useGetLoans({ status: 'all' });
  const [modal, setModal] = useState<FormKind | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const refresh = () => { void Promise.all([summary.refetch(), activity.refetch(), loans.refetch()]); };
  const stats = summary.data;
  const activeLoans = (loans.data || []).filter((loan) => loan.status !== 'returned');
  const searchTerm = search.trim().toLowerCase();
  const visibleLoans = activeLoans.filter((loan) => !searchTerm || `${loan.bookTitle} ${loan.memberName}`.toLowerCase().includes(searchTerm));
  const today = new Date().toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
  return <div className="page-content rr-dashboard">
    <section className="rr-intro">
      <div>
        <div className="rr-kicker"><span>THE READING ROOM</span><i />{today}</div>
        <h1>A good day <em>to read.</em></h1>
        <p>Here’s what’s happening around your library.</p>
      </div>
      <div className="rr-intro-actions">
        <button className="rr-quiet-action" onClick={() => setSearchOpen((open) => !open)} aria-label={searchOpen ? 'Close loan search' : 'Search active loans'} aria-expanded={searchOpen}>
          {searchOpen ? <X size={17} /> : <Search size={17} />}
        </button>
        <button className="rr-issue-button" onClick={() => setModal('loan')} data-testid="button-issue-book"><Plus size={16} />Issue a book</button>
      </div>
    </section>
    {searchOpen && <label className="rr-search-bar">
      <Search size={16} />
      <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a book or reader in the lending desk…" aria-label="Search active loans" />
      {search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={15} /></button>}
    </label>}
    <section className="rr-today" aria-label="Library at a glance">
      <div className="rr-today-heading">
        <span className="rr-today-seal"><BookOpen size={18} /></span>
        <span>YOUR LIBRARY, TODAY</span>
        <span className="rr-today-date"><CalendarDays size={13} /> AT A GLANCE</span>
      </div>
      {summary.isError
        ? <div className="rr-summary-error"><QueryError onRetry={refresh} /></div>
        : <div className="rr-stat-strip">
          <div className="rr-stat rr-stat-feature"><span>IN THE CATALOGUE</span><strong>{stats?.totalBooks ?? '—'}</strong><small>{stats?.totalCopies ?? '—'} total copies</small></div>
          <div className="rr-stat"><span>READERS</span><strong>{stats?.totalMembers ?? '—'}</strong><small>registered members</small></div>
          <div className="rr-stat"><span>OUT ON LOAN</span><strong>{stats?.activeLoans ?? '—'}</strong><small>books with readers</small></div>
          <div className={`rr-stat rr-stat-alert ${stats?.overdueLoans ? 'has-overdue' : ''}`}><span>NEEDS ATTENTION</span><strong>{stats?.overdueLoans ?? '—'}</strong><small>{stats?.overdueLoans ? 'overdue returns' : 'No overdue books'}</small></div>
        </div>}
      <div className="rr-availability">
        <span className="rr-availability-mark"><Check size={15} /></span>
        <b>{stats?.availableCopies ?? '—'} copies ready to go</b>
        <span>Available for your next reader.</span>
        <Link href="/books">Browse catalogue <ArrowRight size={14} /></Link>
      </div>
    </section>
    <div className="rr-workspace">
      <section className="rr-loans">
        <div className="rr-section-head">
          <div>
            <div className="rr-section-kicker">KEEP AN EYE ON <span>·</span> LENDING DESK</div>
            <h2>Currently borrowed</h2>
            <p>Showing {visibleLoans.length} of {stats?.activeLoans ?? activeLoans.length} books out in the community.</p>
          </div>
          <Link className="rr-all-link" href="/loans">All loans <ArrowRight size={15} /></Link>
        </div>
        <div className="rr-loan-list">
          {loans.isLoading
            ? <div className="rr-loading-rows"><div className="skeleton skeleton-block" /><div className="skeleton skeleton-block" /><div className="skeleton skeleton-block" /></div>
            : loans.isError
              ? <QueryError onRetry={() => void loans.refetch()} />
              : visibleLoans.length
                ? visibleLoans.slice(0, 4).map((loan) => <MiniLoan loan={loan} key={loan.id} onReturn={refresh} />)
                : <div className="rr-empty"><BadgeCheck size={18} /><b>{searchTerm ? 'No matching loans' : 'No books are currently checked out'}</b><span>{searchTerm ? 'Try another book title or reader.' : 'Issued books will appear here.'}</span></div>}
        </div>
        <div className="rr-loan-foot"><span><BookOpen size={14} /> {stats?.activeLoans ?? activeLoans.length} active loans in the register</span><Link href="/loans">Open lending register <ArrowRight size={14} /></Link></div>
      </section>
      <aside className="rr-activity">
        <div className="rr-activity-head">
          <div><div className="rr-section-kicker">THE DESK LOG</div><h2>Recent activity</h2></div>
          <span className="rr-activity-icon"><Activity size={17} /></span>
        </div>
        {activity.isLoading
          ? <div className="rr-timeline rr-activity-loading">{[1, 2, 3, 4].map((item) => <div className="skeleton skeleton-line" key={item} />)}</div>
          : activity.isError
            ? <QueryError onRetry={() => void activity.refetch()} />
            : activity.data?.length
              ? <div className="rr-timeline">{activity.data.slice(0, 4).map((item, index) => <div className="rr-activity-item" key={`${item.id}-${item.kind}`} data-testid={`activity-item-${item.id}`}>
                <span className={`rr-activity-symbol ${item.kind}`} aria-label={item.kind === 'issued' ? 'Book issued' : 'Book returned'}><i>{item.kind === 'issued' ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}</i></span>
                <div className="rr-activity-copy"><div><b>{item.memberName}</b> <span>{item.kind === 'issued' ? 'borrowed' : 'returned'}</span></div><p>{item.bookTitle}</p><time>{timeAgo(item.occurredAt)}</time></div>
                {index === 0 && <i className="rr-new-marker" />}
              </div>)}</div>
              : <div className="rr-empty"><Activity size={18} /><b>Quiet at the desk</b><span>New checkouts and returns will show up here.</span></div>}
        <Link href="/loans" className="rr-activity-link">View lending activity <ArrowRight size={14} /></Link>
        <div className="rr-desk-quote"><span className="rr-quote-rule" /><p>“A library is not a luxury but one of the necessities of life.”</p><small>HENRY WARD BEECHER</small></div>
      </aside>
    </div>
    {modal && <Editor kind={modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }} />}
  </div>;
}
function MiniLoan({ loan, onReturn }: { loan: Loan; onReturn: () => void }) {
  const qc = useQueryClient();
  const returnMutation = useReturnLoan();
  const overdue = loan.status === 'overdue';
  return <article className="rr-loan-row" data-testid={`row-loan-${loan.id}`}>
    <span className={`rr-book-cover cover-${['sage', 'ochre', 'rose', 'blue'][loan.bookId % 4]}`} aria-hidden="true"><span className="rr-cover-line" /><BookOpen size={18} strokeWidth={1.5} /></span>
    <div className="rr-book-copy"><span className="rr-row-index">{String(loan.id).padStart(2, '0')} <i /></span><h3>{loan.bookTitle}</h3><p>Library collection</p></div>
    <div className="rr-borrower"><span>WITH READER</span><b><i>{loan.memberName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</i>{loan.memberName}</b></div>
    <div className={`rr-due ${overdue ? 'is-overdue' : ''}`}><span>{overdue ? 'PAST DUE' : 'DUE BACK'}</span><b>{dateLabel(loan.dueAt)}</b></div>
    <button className="rr-return" disabled={returnMutation.isPending} onClick={async () => {
      if (!window.confirm(`Mark “${loan.bookTitle}” returned by ${loan.memberName}?`)) return;
      try {
        await returnMutation.mutateAsync({ loanId: loan.id });
        await Promise.all([qc.invalidateQueries({ queryKey: getGetLoansQueryKey() }), qc.invalidateQueries({ queryKey: getGetBooksQueryKey() }), qc.invalidateQueries({ queryKey: getGetMembersQueryKey() }), qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }), qc.invalidateQueries({ queryKey: getGetActivityQueryKey() })]);
        onReturn();
      } catch (error) { alert(serverError(error)); }
    }} data-testid={`button-return-${loan.id}`}><ArrowDownLeft size={14} />Return</button>
  </article>;
}

function BooksPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Book>();
  const books = useGetBooks(search.trim() ? { search: search.trim() } : undefined);
  const deleteMutation = useDeleteBook();
  const clear = () => { setModal(false); setEditing(undefined); };
  const remove = async (book: Book) => {
    if (!window.confirm(`Remove “${book.title}” from the catalogue? This cannot be undone.`)) return;
    try { await deleteMutation.mutateAsync({ bookId: book.id }); await Promise.all([qc.invalidateQueries({ queryKey: getGetBooksQueryKey() }), qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() })]); }
    catch (error) { alert(serverError(error)); }
  };
  return <div className="page-content"><TopBar title="The catalogue" subtitle="Every story on your shelves, all in one place." action={<button className="button button-primary" onClick={() => { setEditing(undefined); setModal(true); }} data-testid="button-add-book"><Plus size={16} /> Add a book</button>} />
    <section className="data-panel"><div className="panel-toolbar"><div><div className="eyebrow">SHELF INDEX</div><h2>Books <span className="count-tag">{books.data?.length ?? '—'}</span></h2></div><label className="searchbox"><Search size={16} /><input data-testid="input-search-books" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, author, ISBN…" /><kbd>⌘ K</kbd>{search && <button aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}</label></div>
      {books.isLoading ? <PageLoading /> : books.isError ? <QueryError onRetry={() => books.refetch()} /> : books.data?.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>BOOK</th><th>ISBN</th><th>CATEGORY</th><th>AVAILABILITY</th><th className="actions-heading">ACTIONS</th></tr></thead><tbody>{books.data.map((book) => <tr key={book.id} data-testid={`row-book-${book.id}`}><td><div className="title-cell"><span className="book-cover" data-tone={book.id % 5}><BookOpen size={17} /></span><span><b>{book.title}</b><small>{book.author}</small></span></div></td><td className="mono-cell">{book.isbn}</td><td><span className="category-tag">{book.category}</span></td><td><div className="availability"><div className="availability-bar"><i style={{ width: `${Math.max(8, Math.min(100, book.totalCopies ? book.availableCopies / book.totalCopies * 100 : 0))}%` }} /></div><span><b>{book.availableCopies}</b> / {book.totalCopies} copies</span></div></td><td><div className="row-actions"><button className="icon-button row-action" onClick={() => { setEditing(book); setModal(true); }} aria-label={`Edit ${book.title}`} data-testid={`button-edit-book-${book.id}`}><Pencil size={15} /></button><button className="icon-button row-action destructive-action" onClick={() => void remove(book)} aria-label={`Delete ${book.title}`} data-testid={`button-delete-book-${book.id}`}><Trash2 size={15} /></button></div></td></tr>)}</tbody></table></div> : <EmptyState title={search ? 'No books found' : 'Your shelves are waiting'} detail={search ? 'Try a different title, author, or ISBN.' : 'Add the first title to begin building your catalogue.'} action={!search ? <button className="button button-primary" onClick={() => setModal(true)}><Plus size={16} /> Add a book</button> : undefined} />}
    </section>
    <div className="page-footnote"><span><BookOpen size={14} /> {books.data?.length || 0} titles in this view</span><span>Last updated just now</span></div>
    {modal && <Editor kind="book" record={editing} onClose={clear} onSaved={() => { clear(); void books.refetch(); }} />}
  </div>;
}

function MembersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Member>();
  const members = useGetMembers(search.trim() ? { search: search.trim() } : undefined);
  const deleteMutation = useDeleteMember();
  const clear = () => { setModal(false); setEditing(undefined); };
  const remove = async (member: Member) => {
    if (member.activeLoans > 0) { alert(`${member.name} has ${member.activeLoans} active loan(s). Return them before removing this member.`); return; }
    if (!window.confirm(`Remove ${member.name} from the member register? This cannot be undone.`)) return;
    try { await deleteMutation.mutateAsync({ memberId: member.id }); await Promise.all([qc.invalidateQueries({ queryKey: getGetMembersQueryKey() }), qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() })]); }
    catch (error) { alert(serverError(error)); }
  };
  return <div className="page-content"><TopBar title="Our readers" subtitle="The people who make this library a community." action={<button className="button button-primary" onClick={() => { setEditing(undefined); setModal(true); }} data-testid="button-add-member"><Plus size={16} /> Register member</button>} />
    <section className="data-panel"><div className="panel-toolbar"><div><div className="eyebrow">MEMBER REGISTER</div><h2>Readers <span className="count-tag">{members.data?.length ?? '—'}</span></h2></div><label className="searchbox"><Search size={16} /><input data-testid="input-search-members" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, phone…" />{search && <button aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}</label></div>
      {members.isLoading ? <PageLoading /> : members.isError ? <QueryError onRetry={() => members.refetch()} /> : members.data?.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>MEMBER</th><th>CONTACT</th><th>JOINED</th><th>ACTIVE LOANS</th><th className="actions-heading">ACTIONS</th></tr></thead><tbody>{members.data.map((member) => <tr key={member.id} data-testid={`row-member-${member.id}`}><td><div className="member-cell"><div className="member-avatar" data-tone={member.id % 5}>{member.name.split(/\s+/).map((name) => name[0]).slice(0, 2).join('').toUpperCase()}</div><span><b>{member.name}</b><small>Reader ID · {String(member.id).padStart(4, '0')}</small></span></div></td><td><div className="contact-cell"><b>{member.email}</b><small>{member.phone || 'No phone added'}</small></div></td><td>{dateLabel(member.joinedAt)}</td><td><span className={`loan-number ${member.activeLoans ? 'loan-number-active' : ''}`}>{member.activeLoans}</span>{member.activeLoans === 1 ? ' book' : ' books'}</td><td><div className="row-actions"><button className="icon-button row-action" onClick={() => { setEditing(member); setModal(true); }} aria-label={`Edit ${member.name}`} data-testid={`button-edit-member-${member.id}`}><Pencil size={15} /></button><button className="icon-button row-action destructive-action" onClick={() => void remove(member)} aria-label={`Delete ${member.name}`} data-testid={`button-delete-member-${member.id}`}><Trash2 size={15} /></button></div></td></tr>)}</tbody></table></div> : <EmptyState title={search ? 'No readers found' : 'Your community starts here'} detail={search ? 'Try another name or contact detail.' : 'Register your first member to get started.'} action={!search ? <button className="button button-primary" onClick={() => setModal(true)}><Plus size={16} /> Register member</button> : undefined} />}
    </section><div className="page-footnote"><span><UsersRound size={14} /> {members.data?.length || 0} members in this view</span><span>Member information is kept private</span></div>
    {modal && <Editor kind="member" record={editing} onClose={clear} onSaved={() => { clear(); void members.refetch(); }} />}
  </div>;
}

function LoansPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'all' | 'active' | 'overdue' | 'returned'>('all');
  const [modal, setModal] = useState(false);
  const loans = useGetLoans({ status });
  const returnMutation = useReturnLoan();
  const returnBook = async (loan: Loan) => {
    if (!window.confirm(`Mark “${loan.bookTitle}” returned by ${loan.memberName}?`)) return;
    try { await returnMutation.mutateAsync({ loanId: loan.id }); await Promise.all([qc.invalidateQueries({ queryKey: getGetLoansQueryKey() }), qc.invalidateQueries({ queryKey: getGetBooksQueryKey() }), qc.invalidateQueries({ queryKey: getGetMembersQueryKey() }), qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }), qc.invalidateQueries({ queryKey: getGetActivityQueryKey() })]); }
    catch (error) { alert(serverError(error)); }
  };
  const filters: Array<{ key: typeof status; label: string }> = [{ key: 'all', label: 'All loans' }, { key: 'active', label: 'On loan' }, { key: 'overdue', label: 'Overdue' }, { key: 'returned', label: 'Returned' }];
  return <div className="page-content"><TopBar title="Loans & returns" subtitle="A clear view of every book out in the world." action={<button className="button button-primary" onClick={() => setModal(true)} data-testid="button-new-loan"><Plus size={16} /> Issue a book</button>} />
    <section className="data-panel"><div className="panel-toolbar loan-toolbar"><div><div className="eyebrow">LENDING DESK</div><h2>Loan register <span className="count-tag">{loans.data?.length ?? '—'}</span></h2></div><div className="filter-tabs" role="tablist" aria-label="Filter loans">{filters.map((filter) => <button className={status === filter.key ? 'filter-tab selected' : 'filter-tab'} onClick={() => setStatus(filter.key)} key={filter.key} role="tab" aria-selected={status === filter.key} data-testid={`filter-loans-${filter.key}`}>{filter.label}</button>)}</div></div>
      {loans.isLoading ? <PageLoading /> : loans.isError ? <QueryError onRetry={() => loans.refetch()} /> : loans.data?.length ? <div className="table-scroll"><table className="data-table loan-table"><thead><tr><th>BOOK & READER</th><th>ISSUED</th><th>DUE DATE</th><th>STATUS</th><th className="actions-heading">ACTION</th></tr></thead><tbody>{loans.data.map((loan) => <tr key={loan.id} data-testid={`row-loan-${loan.id}`}><td><div className="loan-book"><span className="book-cover small-cover" data-tone={loan.bookId % 5}><BookOpen size={16} /></span><span><b>{loan.bookTitle}</b><small>Borrowed by {loan.memberName}</small></span></div></td><td>{dateLabel(loan.issuedAt)}</td><td><span className={loan.status === 'overdue' ? 'overdue-text' : ''}>{dateLabel(loan.dueAt)}</span></td><td><StatusPill status={loan.status} /></td><td><div className="row-actions">{loan.status !== 'returned' ? <button className="return-button" onClick={() => void returnBook(loan)} disabled={returnMutation.isPending} data-testid={`button-return-loan-${loan.id}`}><ArrowDownLeft size={14} /> Return</button> : <span className="returned-date">Returned {dateLabel(loan.returnedAt)}</span>}</div></td></tr>)}</tbody></table></div> : <EmptyState title={status === 'all' ? 'No lending activity yet' : `No ${status === 'active' ? 'books on loan' : status + ' loans'}`} detail={status === 'all' ? 'Issued books will appear here, ready to track.' : 'Try another filter or issue a book to a reader.'} action={<button className="button button-primary" onClick={() => setModal(true)}><Plus size={16} /> Issue a book</button>} />}
    </section><div className="page-footnote"><span><ArrowUpRight size={14} /> {loans.data?.length || 0} loans in this view</span><span>Use filters to find returns that need attention</span></div>
    {modal && <Editor kind="loan" onClose={() => setModal(false)} onSaved={() => { setModal(false); void loans.refetch(); }} />}
  </div>;
}

function AppShell() {
  return <Shell><Switch><Route path="/" component={Overview} /><Route path="/books" component={BooksPage} /><Route path="/members" component={MembersPage} /><Route path="/loans" component={LoansPage} /><Route component={NotFound} /></Switch></Shell>;
}
function App() {
  return <QueryClientProvider client={queryClient}><AppShell /></QueryClientProvider>;
}

export default App;