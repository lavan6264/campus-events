import Button from "../components/Button.jsx";
import { useAuth } from "../lib/auth.jsx";
import styles from "./pages.module.css";

const COPY = {
  401: { title: "Please sign in", text: "You need to sign in to see this page." },
  403: { title: "You cannot open this page", text: "Your role does not include access to it. Ask an admin if you think that is wrong." },
  404: { title: "Page not found", text: "The page may have moved, or the link may be wrong." },
};

/** Clear 401, 403 and 404 pages. Signed in people get their way back to the dashboard. */
export default function ErrorPage({ code = 404 }) {
  const { isAuthenticated } = useAuth();
  const copy = COPY[code];
  return (
    <section className={`${styles.errorPage} glass-2`}>
      <p className={`${styles.code} mono muted`}>{code}</p>
      <h2>{copy.title}</h2>
      <p className="muted">{copy.text}</p>
      {isAuthenticated ? (
        <Button variant="primary" to="/">
          Back to the dashboard
        </Button>
      ) : (
        <Button variant="primary" to="/login">
          Go to sign in
        </Button>
      )}
    </section>
  );
}
