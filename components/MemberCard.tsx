"use client";

import { X } from "lucide-react";
import {
  memberKey,
  TYPE_LABELS,
  type Member,
} from "@/lib/model";
import { titleKey, type Box, type Sheet, type SheetIndex } from "@/lib/sheets";
import styles from "./App.module.css";

function levelText(m: Member) {
  const toM = (mm: number) => `${(mm / 1000).toFixed(2)}m`;
  if (!("z" in m)) return `${toM(m.z0)} 〜 ${toM(m.z1)}`;
  const end = "z1" in m ? m.z1 : undefined;
  return end === undefined || end === m.z
    ? toM(m.z)
    : `${toM(m.z)} 〜 ${toM(end)}`;
}

function MemberSheets({
  member,
  index,
  confirmed,
  onOpen,
}: {
  member: Member;
  index?: SheetIndex;
  confirmed?: ReadonlySet<string>;
  onOpen: (sheet: Sheet, bbox: Box | undefined, label: string) => void;
}) {
  if (!index) return null;
  const isConfirmed = (id: string) => {
    const title = index.sheets.find((s) => s.id === id)?.title;
    return Boolean(title && confirmed?.has(titleKey(title)));
  };
  // 確定版のある図面を先に出す
  const refs = [...(index.member_sheets[memberKey(member)] ?? [])].sort(
    (a, b) => Number(isConfirmed(b.sheet)) - Number(isConfirmed(a.sheet)),
  );
  return (
    <div className={styles.sheets}>
      <h3>この部材を含む施工図（{refs.length}）</h3>
      {refs.length === 0 ? (
        <p className={styles.fine}>{index.empty_note}</p>
      ) : (
        <ul>
          {refs.map((ref) => {
            const sheet = index.sheets.find((s) => s.id === ref.sheet);
            if (!sheet) return null;
            return (
              <li key={`${ref.sheet}-${ref.reason}`}>
                <button
                  onClick={() =>
                    onOpen(sheet, ref.bbox, `${member.mark} ${member.grid}`)
                  }
                >
                  <b>
                    p.{sheet.page} {sheet.title}
                    {isConfirmed(sheet.id) && "（確定版）"}
                  </b>
                  <span>{ref.reason}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// クリックした部材の情報と、その部材を含む施工図
export default function MemberCard({
  member,
  index,
  confirmed,
  onClose,
  onOpen,
}: {
  member: Member;
  index?: SheetIndex;
  confirmed?: ReadonlySet<string>;
  onClose: () => void;
  onOpen: (sheet: Sheet, bbox: Box | undefined, label: string) => void;
}) {
  return (
    <div className={styles.memberCard}>
      <button
        className={styles.closeMember}
        aria-label="部材の情報を閉じる"
        onClick={onClose}
      >
        <X size={14} />
      </button>
      <span className={`${styles.mark} mono`}>{member.mark}</span>
      <span className={styles.type}>{TYPE_LABELS[member.type]}</span>
      <dl className={styles.details}>
        <dt>階</dt>
        <dd className="mono">{member.floor}</dd>
        <dt>位置</dt>
        <dd className="mono">{member.grid}</dd>
        <dt>{"z" in member ? "レベル" : "高さ"}</dt>
        <dd className="mono">{levelText(member)}</dd>
        {member.section && (
          <>
            <dt>断面</dt>
            <dd className="mono">{member.section}</dd>
          </>
        )}
      </dl>
      <MemberSheets member={member} index={index} confirmed={confirmed} onOpen={onOpen} />
    </div>
  );
}
