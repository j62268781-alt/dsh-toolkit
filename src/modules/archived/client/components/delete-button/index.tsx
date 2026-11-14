import React from "react";
import { primitives } from "../../../../../client/ui/primitives.js";

export { default as css } from "./style.css";

/**
 * The host Button has no loading state, so the ring is drawn here.
 *
 * `aria-busy` is what the sheet keys on to keep a working button at full opacity:
 * a delete in flight is unavailable, not disabled, and graying it out was most of
 * what read as "the page flashed".
 */
/** `className` stays optional: call sites append it to the module's own class. */
export interface DeleteButtonProps {
  children?: any;
  size?: string;
  className?: string;
  loading?: boolean;
  [key: string]: any;
}

export function DeleteButton({ children, size = "md", className, loading = false, ...props }: DeleteButtonProps) {
  const Button = primitives.Button;
  const Icon = primitives.IconTrashOutlineRegular;
  const classes = className === undefined ? "sk-arch__delete" : `sk-arch__delete ${className}`;
  const spinner = loading ? <span className="sk-arch__spinner" aria-hidden="true" /> : null;
  if (Button === undefined) {
    return <button type="button" className={classes} aria-busy={loading || undefined} {...props}>
      {spinner}
      {children}
    </button>;
  }
  return <Button type="button" variant="outline" size={size} className={classes}
    aria-busy={loading || undefined}
    icon={spinner ?? (Icon ? <Icon size={16} /> : undefined)} {...props}>
    {children}
  </Button>;
}
