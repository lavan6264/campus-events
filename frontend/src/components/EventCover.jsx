import { useState } from "react";
import { assetUrl } from "../lib/crud/api.js";
import styles from "./EventCover.module.css";

/**
 * The cover of an event card. If the organizer gave an image link it is shown. Otherwise, or if the
 * image cannot load, a drawn cover is used: one abstract motif per category, in the theme's own colours,
 * shifted a little by the event id so neighbouring cards do not look identical.
 */

const W = 320;
const H = 180;

function Workshop({ s }) {
  const x = 150 + s * 6;
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={x - i * 26} y={90 - i * 26} width={i * 52 + 52} height={i * 52 + 52} rx="10" className={i % 2 ? styles.fillSoft : styles.stroke} />
      ))}
      {Array.from({ length: 12 }, (_, i) => (
        <circle key={i} cx={30 + (i % 4) * 22} cy={30 + Math.floor(i / 4) * 22} r="3" className={styles.dot} />
      ))}
    </>
  );
}

function Seminar({ s }) {
  return (
    <>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={i} x={40 + i * 40} y={150 - (i + 1) * 18 - s * 4} width="28" height={(i + 1) * 18 + s * 4} rx="5" className={i % 2 ? styles.fillSoft : styles.fill} />
      ))}
      <circle cx={250 - s * 8} cy="52" r="22" className={styles.stroke} />
      <circle cx={250 - s * 8} cy="52" r="8" className={styles.dot} />
    </>
  );
}

function Competition({ s }) {
  const cx = 160 + (s - 2) * 10;
  return (
    <>
      {Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2;
        return <line key={i} x1={cx + Math.cos(a) * 34} y1={90 + Math.sin(a) * 34} x2={cx + Math.cos(a) * (i % 2 ? 62 : 82)} y2={90 + Math.sin(a) * (i % 2 ? 62 : 82)} className={styles.line} />;
      })}
      <circle cx={cx} cy="90" r="26" className={styles.fillSoft} />
      <circle cx={cx} cy="90" r="12" className={styles.fill} />
    </>
  );
}

function Cultural({ s }) {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <path
          key={i}
          d={`M-10 ${50 + i * 24} C ${60 + s * 8} ${20 + i * 24}, ${120 - s * 6} ${90 + i * 24}, ${190} ${50 + i * 24} S ${290} ${20 + i * 24}, 340 ${54 + i * 24}`}
          className={i % 2 ? styles.lineSoft : styles.line}
          fill="none"
        />
      ))}
      <circle cx={256 - s * 10} cy="46" r="20" className={styles.fillSoft} />
    </>
  );
}

function Sports({ s }) {
  const cx = 170 + (s - 2) * 12;
  return (
    <>
      <circle cx={cx} cy="90" r="58" className={styles.stroke} />
      <path d={`M${cx - 58} 90 H${cx + 58} M${cx} 32 V148`} className={styles.line} fill="none" />
      <path d={`M${cx - 41} 49 C${cx - 14} 72, ${cx - 14} 108, ${cx - 41} 131 M${cx + 41} 49 C${cx + 14} 72, ${cx + 14} 108, ${cx + 41} 131`} className={styles.line} fill="none" />
      <circle cx="46" cy="140" r="8" className={styles.dot} />
      <circle cx="274" cy="38" r="5" className={styles.dot} />
    </>
  );
}

function ClubMeet({ s }) {
  const spread = 34 + s * 3;
  return (
    <>
      <circle cx={160 - spread} cy="96" r="52" className={styles.fillSoft} />
      <circle cx={160 + spread} cy="96" r="52" className={styles.fillSoft} />
      <circle cx="160" cy={64 - s * 2} r="52" className={styles.fillSoft} />
      <circle cx="160" cy="96" r="14" className={styles.fill} />
    </>
  );
}

const ART = {
  Workshop, Seminar, Competition, Cultural, Sports, "Club Meet": ClubMeet,
};

export default function EventCover({ event, className = "" }) {
  const [broken, setBroken] = useState(false);
  const Art = ART[event.category] || Workshop;

  if (event.image_url && !broken) {
    return (
      <div className={`${styles.cover} ${className}`}>
        <img src={assetUrl(event.image_url)} alt="" loading="lazy" className={styles.image} onError={() => setBroken(true)} />
      </div>
    );
  }

  return (
    <div className={`${styles.cover} ${className}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className={styles.art} aria-hidden="true" focusable="false">
        <Art s={event.id % 5} />
      </svg>
    </div>
  );
}
