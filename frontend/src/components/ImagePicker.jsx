import { useRef, useState } from "react";
import { api } from "../lib/crud/api.js";
import Button from "./Button.jsx";
import EventCover from "./EventCover.jsx";
import styles from "./ImagePicker.module.css";

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/**
 * Choose a cover image from the computer. It is checked here for a quick answer, then again on the
 * server, which looks at the file's real content. Shows the cover as it will appear on the event card.
 */
export default function ImagePicker({ value, category, onChange }) {
  const input = useRef(null);
  const [state, setState] = useState({ status: "idle" });

  const choose = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!TYPES.includes(file.type)) {
      setState({ status: "error", message: "Use a PNG, JPEG, GIF or WebP image." });
      return;
    }
    if (file.size > MAX_BYTES) {
      setState({ status: "error", message: "Use an image under 2 MB." });
      return;
    }
    setState({ status: "uploading" });
    const form = new FormData();
    form.append("file", file);
    try {
      const result = await api("/uploads/event-image", { method: "POST", body: form });
      onChange(result.url);
      setState({ status: "done" });
    } catch (error) {
      setState({ status: "error", message: error.fields?.file || error.message });
    }
  };

  return (
    <div className={styles.picker}>
      <div className={styles.header}>
        <p className={styles.label}>Cover image</p>
        <p className="small muted">PNG, JPEG, GIF or WebP, up to 2 MB. Without one, a drawn cover is used.</p>
      </div>
      <div className={styles.preview}>
        <EventCover key={value || "none"} event={{ id: 0, category: category || "Workshop", image_url: value || null }} />
      </div>
      <div className={styles.actions}>
        <input
          ref={input}
          type="file"
          accept={TYPES.join(",")}
          className="visually-hidden"
          aria-label="Choose a cover image file"
          tabIndex={-1}
          onChange={choose}
        />
        <Button onClick={() => input.current?.click()} disabled={state.status === "uploading"} aria-busy={state.status === "uploading"}>
          {state.status === "uploading" ? "Uploading" : value ? "Replace image" : "Upload image"}
        </Button>
        {value ? (
          <Button
            variant="ghost"
            onClick={() => {
              onChange("");
              setState({ status: "idle" });
            }}
          >
            Remove image
          </Button>
        ) : null}
        <p className={styles.note} role="status">
          {state.status === "done" ? "Image uploaded. It is used when you save the event." : null}
          {state.status === "error" ? state.message : null}
        </p>
      </div>
    </div>
  );
}
