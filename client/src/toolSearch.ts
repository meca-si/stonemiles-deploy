// toolSearch.ts — by-name search over the tool directory
// (2026-11-25 UX package C, x's order: "make the app easier to
// navigate to what's needed"). Until now the directory could only
// be browsed by group — there was no way to type a tool's name and
// land on it. This is the pure filter half: given a query, the
// matching items across ALL groups, each carrying its group so the
// row can say where the tool lives. Matching is a case-insensitive
// substring over the item's English AND Spanish names (the two
// names the directory itself carries), so a driver searching in
// either language finds the same tool. The rendering surfaces
// (Today's Find-a-tool panel, the More directory) feed the hits
// through the SAME openToolItem jump the group rows use — one
// name, one landing, now also one search.

import { TOOL_GROUPS, type ToolGroup, type ToolItem } from "./toolDirectory";

export interface ToolSearchHit {
  groupId: ToolGroup["id"];
  groupEn: string;
  groupEs: string;
  item: ToolItem;
}

export function filterToolItems(query: string): ToolSearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];
  const hits: ToolSearchHit[] = [];
  for (const group of TOOL_GROUPS) {
    for (const item of group.items) {
      if (item.en.toLowerCase().includes(q) || item.es.toLowerCase().includes(q)) {
        hits.push({ groupId: group.id, groupEn: group.en, groupEs: group.es, item });
      }
    }
  }
  return hits;
}
