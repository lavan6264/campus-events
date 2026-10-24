import Button from "../../components/Button.jsx";
import { Select } from "../../components/Input.jsx";
import Skeleton from "../../components/Skeleton.jsx";
import { ArrowDownIcon, ArrowUpIcon } from "../../components/icons.jsx";
import Pagination from "./Pagination.jsx";
import styles from "./crud.module.css";

/**
 * Config driven table.
 *
 * columns: [{ key, header, render?(row), sortable?, sortKey?, mono?, align?, className? }]
 *   `sortKey` is the field name sent to the API (defaults to `key`).
 * Loading shows skeleton rows (no spinner overlays). Empty shows what to do next. Errors offer a retry.
 * Below 720px every row becomes a stacked block, each cell labelled with its column header.
 */
export default function DataTable({
  columns,
  data,
  isLoading = false,
  isFetching = false,
  error = null,
  onRetry,
  sort,
  onSort,
  onPage,
  empty = { title: "Nothing here yet", text: "" },
  caption,
  noun = "results",
  rowKey = "id",
  skeletonRows = 6,
}) {
  const items = data?.items || [];

  const toggleSort = (col) => {
    const field = col.sortKey || col.key;
    onSort?.(sort === field ? `-${field}` : field);
  };

  const sortState = (col) => {
    const field = col.sortKey || col.key;
    if (sort === field) return "ascending";
    if (sort === `-${field}`) return "descending";
    return "none";
  };

  if (error && !data) {
    return (
      <div className={`${styles.state} glass-2`} role="alert">
        <h2>The list did not load</h2>
        <p className="muted">{error.message || "Something went wrong."}</p>
        {onRetry ? (
          <Button variant="primary" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </div>
    );
  }

  if (!isLoading && items.length === 0) {
    return (
      <div className={`${styles.state} glass-2`}>
        <h2>{empty.title}</h2>
        {empty.text ? <p className="muted">{empty.text}</p> : null}
        {empty.action}
      </div>
    );
  }

  const sortable = columns.filter((c) => c.sortable);
  const sortOptions = sortable.flatMap((c) => {
    const field = c.sortKey || c.key;
    return [
      { value: field, label: `${c.header}, ascending` },
      { value: `-${field}`, label: `${c.header}, descending` },
    ];
  });

  return (
    <div className={`${styles.tableWrap} glass-2`} aria-busy={isLoading || isFetching}>
      {sortable.length && onSort ? (
        <div className={styles.mobileSort}>
          <Select label="Sort by" value={sort || ""} options={sortOptions} onChange={(e) => onSort(e.target.value)} />
        </div>
      ) : null}
      <table className={`${styles.table} ${isFetching && !isLoading ? styles.stale : ""}`}>
        {caption ? <caption className="visually-hidden">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={`${col.align === "right" ? styles.right : ""} ${col.className || ""}`}
                aria-sort={col.sortable ? sortState(col) : undefined}
              >
                {col.sortable ? (
                  <button type="button" className={styles.sortButton} onClick={() => toggleSort(col)}>
                    {col.header}
                    <span className={styles.sortIcon} aria-hidden="true">
                      {sortState(col) === "ascending" ? <ArrowUpIcon size={14} /> : null}
                      {sortState(col) === "descending" ? <ArrowDownIcon size={14} /> : null}
                    </span>
                    <span className="visually-hidden">
                      {sortState(col) === "none" ? ", not sorted, activate to sort" : `, sorted ${sortState(col)}`}
                    </span>
                  </button>
                ) : (
                  col.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? Array.from({ length: skeletonRows }, (_, i) => (
                <tr key={i} aria-hidden="true">
                  {columns.map((col, c) => (
                    <td key={col.key} data-label={col.header}>
                      <Skeleton width={c === 0 ? "60%" : `${50 + ((i * 7 + c * 13) % 40)}%`} />
                    </td>
                  ))}
                </tr>
              ))
            : items.map((row) => (
                <tr key={row[rowKey]}>
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      data-label={col.header}
                      className={`${col.mono ? "mono" : ""} ${col.align === "right" ? styles.right : ""} ${col.className || ""}`}
                    >
                      {col.render ? col.render(row) : row[col.key]}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
      {data ? (
        <div className={styles.footer}>
          <Pagination page={data.page} pages={data.pages} total={data.total} limit={data.limit} onPage={onPage} noun={noun} />
        </div>
      ) : null}
    </div>
  );
}
