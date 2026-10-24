import Button from "../../components/Button.jsx";
import { ChevronLeftIcon, ChevronRightIcon } from "../../components/icons.jsx";
import styles from "./crud.module.css";

function pageWindow(page, pages) {
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  const end = Math.min(pages, start + 4);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export default function Pagination({ page, pages, total, limit, onPage, noun = "results" }) {
  if (!total) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return (
    <nav className={styles.pagination} aria-label="Pagination">
      <p className={`${styles.range} small muted`} aria-live="polite">
        <span className="mono">
          {from}
          {to > from ? ` to ${to}` : ""}
        </span>{" "}
        of <span className="mono">{total}</span> {noun}
      </p>
      {pages > 1 ? (
        <div className={styles.pages}>
          <Button size="sm" variant="ghost" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
            <ChevronLeftIcon size={16} />
          </Button>
          {pageWindow(page, pages).map((p) => (
            <Button
              key={p}
              size="sm"
              variant={p === page ? "secondary" : "ghost"}
              onClick={() => onPage(p)}
              aria-current={p === page ? "page" : undefined}
              aria-label={`Page ${p}`}
            >
              <span className="mono">{p}</span>
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page">
            <ChevronRightIcon size={16} />
          </Button>
        </div>
      ) : null}
    </nav>
  );
}
