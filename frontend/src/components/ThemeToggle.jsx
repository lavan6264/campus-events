import { useTheme } from "../lib/theme.js";
import Button from "./Button.jsx";

/** Says what it will do, so the label is clear without relying on an icon. */
export default function ThemeToggle({ className = "", variant = "ghost" }) {
  const { theme, toggle } = useTheme();
  return (
    <Button variant={variant} size="sm" className={className} onClick={toggle}>
      {theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
    </Button>
  );
}
