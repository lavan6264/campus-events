// The institution name and logo are configurable. No real university branding ships with the app.
export const INSTITUTION_NAME = import.meta.env.VITE_INSTITUTION_NAME || "Campus Events";
export const INSTITUTION_LOGO = import.meta.env.VITE_INSTITUTION_LOGO || "";
export const DEMO_LOGINS = import.meta.env.VITE_DEMO_LOGINS !== "false";

export const DEPARTMENTS = [
  "School of Engineering",
  "School of Management",
  "School of Sciences",
  "School of Arts and Humanities",
  "School of Law",
];
