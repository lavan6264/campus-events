import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useMatches, useNavigate } from "react-router-dom";
import Button from "../components/Button.jsx";
import { CloseIcon, MenuIcon, SearchIcon } from "../components/icons.jsx";
import { useAuth } from "../lib/auth.jsx";
import { INSTITUTION_LOGO, INSTITUTION_NAME } from "../lib/config.js";
import styles from "./Shell.module.css";

const TitleContext = createContext(() => {});

/** Pages with a dynamic title, such as an event page, call this once they know it. */
export function usePageTitle(title) {
  const setTitle = useContext(TitleContext);
  useEffect(() => {
    if (title) setTitle(title);
  }, [title, setTitle]);
}

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/events", label: "Explore events", match: (p) => p === "/events" || /^\/events\/\d+$/.test(p) },
  {
    to: "/my-events", label: "My events", roles: ["faculty", "admin"],
    match: (p) => p === "/my-events" || p === "/events/new" || /^\/events\/\d+\/(edit|participants)$/.test(p),
  },
  { to: "/reports", label: "Reports", roles: ["admin"] },
];

export function Brand({ heading = false }) {
  const Name = heading ? "h1" : "span";
  return (
    <div className={styles.brand}>
      {INSTITUTION_LOGO ? <img src={INSTITUTION_LOGO} alt="" className={styles.logo} /> : null}
      <Name className={styles.brandName}>{INSTITUTION_NAME}</Name>
    </div>
  );
}

export default function Shell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const matches = useMatches();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dynamicTitle, setDynamicTitle] = useState("");
  const menuButton = useRef(null);
  const sidebar = useRef(null);

  const routeTitle = [...matches].reverse().find((m) => m.handle?.title)?.handle.title || "";
  const title = dynamicTitle || routeTitle;
  const setTitle = useCallback((t) => setDynamicTitle(t), []);

  useEffect(() => {
    setDynamicTitle("");
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.title = title ? `${title} | ${INSTITUTION_NAME}` : INSTITUTION_NAME;
  }, [title]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    sidebar.current?.querySelector("a")?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const items = useMemo(() => NAV.filter((item) => !item.roles || item.roles.includes(user.role)), [user.role]);

  const onSearch = (event) => {
    event.preventDefault();
    const q = new FormData(event.currentTarget).get("q")?.toString().trim();
    navigate(q ? `/events?q=${encodeURIComponent(q)}` : "/events");
  };

  return (
    <TitleContext.Provider value={setTitle}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className={styles.app}>
        {menuOpen ? <div className={styles.scrim} onClick={() => setMenuOpen(false)} aria-hidden="true" /> : null}
        <aside ref={sidebar} id="site-menu" className={`${styles.sidebar} glass-1 ${menuOpen ? styles.open : ""}`} aria-label="Main">
          <div className={styles.sidebarTop}>
            <Brand />
            <button type="button" className={styles.closeMenu} onClick={() => setMenuOpen(false)} aria-label="Close menu">
              <CloseIcon />
            </button>
          </div>
          <nav className={styles.nav} aria-label="Primary">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `${styles.link} ${(item.match ? item.match(location.pathname) : isActive) ? styles.active : ""}`
                }
                aria-current={(item.match ? item.match(location.pathname) : location.pathname === item.to) ? "page" : undefined}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className={styles.account}>
            <p className={styles.userName}>{user.name}</p>
            <p className={`${styles.userRole} small muted`}>
              {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
              {user.department ? `, ${user.department}` : ""}
            </p>
            <Button className={styles.logout} onClick={logout}>
              Sign out
            </Button>
          </div>
        </aside>

        <div className={styles.main}>
          <header className={styles.topbar}>
            <Button
              ref={menuButton}
              className={styles.menuButton}
              onClick={() => setMenuOpen(true)}
              aria-expanded={menuOpen}
              aria-controls="site-menu"
            >
              <MenuIcon size={18} />
              Menu
            </Button>
            <h1 className={styles.title}>{title}</h1>
            <form className={styles.search} onSubmit={onSearch} role="search">
              <label htmlFor="topbar-search" className="visually-hidden">
                Search events
              </label>
              <SearchIcon size={16} className={styles.searchIcon} />
              <input id="topbar-search" name="q" type="search" placeholder="Search events" autoComplete="off" />
            </form>
          </header>
          <main id="main" className={styles.content} tabIndex={-1}>
            <Outlet />
          </main>
        </div>
      </div>
    </TitleContext.Provider>
  );
}
