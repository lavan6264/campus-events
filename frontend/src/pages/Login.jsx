import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import Button from "../components/Button.jsx";
import Tabs from "../components/Tabs.jsx";
import { Brand } from "../app/Shell.jsx";
import { useAuth } from "../lib/auth.jsx";
import { DEMO_LOGINS, DEPARTMENTS, INSTITUTION_NAME } from "../lib/config.js";
import ResourceForm from "../lib/crud/ResourceForm.jsx";
import styles from "./pages.module.css";

const EMAIL_PATTERN = { regex: /^[^@\s]+@[^@\s]+\.[^@\s]+$/, message: "Enter a valid email address" };

const loginFields = [
  { name: "email", label: "Email", type: "email", required: true, pattern: EMAIL_PATTERN, autoComplete: "username", span: 2 },
  { name: "password", label: "Password", type: "password", required: true, autoComplete: "current-password", span: 2 },
];

const registerFields = [
  { name: "name", label: "Full name", required: true, maxLength: 120, autoComplete: "name", span: 2 },
  { name: "email", label: "Email", type: "email", required: true, pattern: EMAIL_PATTERN, autoComplete: "username", span: 2 },
  {
    name: "password", label: "Password", type: "password", required: true, minLength: 8, maxLength: 128,
    help: "At least 8 characters.", autoComplete: "new-password", span: 2,
  },
  {
    name: "role", label: "I am a", type: "select", required: true, placeholder: "Choose one",
    options: [{ value: "student", label: "Student" }, { value: "faculty", label: "Faculty member" }],
  },
  {
    name: "department", label: "Department", type: "select", emptyAs: null, placeholder: "Not set",
    options: DEPARTMENTS.map((d) => ({ value: d, label: d })),
  },
];

const DEMOS = [
  { label: "Admin", email: "admin@campus-demo.test", password: "admin123" },
  { label: "Faculty", email: "faculty1@campus-demo.test", password: "faculty123" },
  { label: "Student", email: "aarav.sharma@campus-demo.test", password: "student123" },
];

const TABS = [
  { id: "login", label: "Sign in" },
  { id: "register", label: "Create account" },
];

export default function Login() {
  const { isAuthenticated, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState("login");
  const from = location.state?.from || "/";

  if (isAuthenticated) return <Navigate to={from} replace />;

  const done = () => navigate(from, { replace: true });

  return (
    <main className={styles.loginPage}>
      <div className={styles.loginBrand}>
        <Brand heading />
        <p className="muted">Find, join and run events on campus.</p>
      </div>
      <section className={`${styles.loginPanel} glass-2`} aria-label={`${INSTITUTION_NAME} account`}>
        <Tabs tabs={TABS} value={mode} onChange={setMode} label="Account" idPrefix="auth" withPanels />
        <div role="tabpanel" id={`auth-panel-${mode}`} aria-labelledby={`auth-tab-${mode}`} className={styles.loginForm}>
          {location.state?.from ? <p className="small muted">Sign in to open that page.</p> : null}
          {mode === "login" ? (
            <ResourceForm
              key="login"
              fields={loginFields}
              submitLabel="Sign in"
              savingLabel="Signing in"
              onSubmit={async (payload) => {
                await login(payload.email, payload.password);
                done();
              }}
              before={({ setValues }) =>
                DEMO_LOGINS ? (
                  <div className={styles.demo}>
                    <p className="small muted">Demo accounts</p>
                    <div className={styles.demoButtons}>
                      {DEMOS.map((d) => (
                        <Button key={d.label} size="sm" onClick={() => setValues({ email: d.email, password: d.password })}>
                          {d.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null
              }
            />
          ) : (
            <ResourceForm
              key="register"
              fields={registerFields}
              initialValues={{ role: "student" }}
              submitLabel="Create account"
              savingLabel="Creating account"
              onSubmit={async (payload) => {
                await register(payload);
                done();
              }}
            />
          )}
        </div>
      </section>
    </main>
  );
}
