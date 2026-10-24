import { Fragment } from "react";
import Button from "../../components/Button.jsx";
import { Select } from "../../components/Input.jsx";
import Skeleton from "../../components/Skeleton.jsx";
import Pagination from "./Pagination.jsx";
import styles from "./crud.module.css";

/**
 * The card version of DataTable, driven by the same list response and the same states:
 * skeleton cards while loading (no spinners), an empty state with a next step, an error with retry,
 * pagination, and an optional "Sort by" control.
 *
 * renderCard(row) returns the card. sortOptions: [{ value, label }], with sort and onSort.
 */
export default function CardGrid({
  data,
  isLoading = false,
  isFetching = false,
  error = null,
  onRetry,
  onPage,
  renderCard,
  empty = { title: "Nothing here yet", text: "" },
  noun = "results",
  rowKey = "id",
  skeletons = 6,
  sort,
  onSort,
  sortOptions,
}) {
  const items = data?.items || [];

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

  return (
    <div className={styles.cardsWrap}>
      {sortOptions && onSort ? (
        <div className={styles.cardsToolbar}>
          <Select label="Sort by" value={sort || ""} options={sortOptions} onChange={(e) => onSort(e.target.value)} />
        </div>
      ) : null}
      <div className={`${styles.cardGrid} ${isFetching && !isLoading ? styles.stale : ""}`} aria-busy={isLoading || isFetching}>
        {isLoading
          ? Array.from({ length: skeletons }, (_, i) => (
              <div key={i} className={`${styles.skeletonCard} glass-2`} aria-hidden="true">
                <div className={styles.skeletonCover} />
                <div className={styles.skeletonBody}>
                  <Skeleton width="30%" height={12} />
                  <Skeleton width="80%" height={18} />
                  <Skeleton width="55%" />
                  <Skeleton width="100%" height={40} />
                </div>
              </div>
            ))
          : items.map((row) => <Fragment key={row[rowKey]}>{renderCard(row)}</Fragment>)}
      </div>
      {data ? (
        <div className={styles.cardsFooter}>
          <Pagination page={data.page} pages={data.pages} total={data.total} limit={data.limit} onPage={onPage} noun={noun} />
        </div>
      ) : null}
    </div>
  );
}
