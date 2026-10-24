import { forwardRef } from "react";
import { Link } from "react-router-dom";
import styles from "./Button.module.css";

/**
 * variant: primary (solid accent), secondary (glass with hairline), danger (clay text, hairline), ghost (text only).
 * Pass `to` to render a router link that looks like a button, `href` for a plain link.
 */
const Button = forwardRef(function Button({
  variant = "secondary",
  size = "md",
  to,
  href,
  type = "button",
  className = "",
  children,
  ...props
}, ref) {
  const cls = `${styles.button} ${styles[variant]} ${size === "sm" ? styles.sm : ""} ${className}`;
  if (to) return <Link ref={ref} to={to} className={cls} {...props}>{children}</Link>;
  if (href) return <a ref={ref} href={href} className={cls} {...props}>{children}</a>;
  return <button ref={ref} type={type} className={cls} {...props}>{children}</button>;
});

export default Button;
