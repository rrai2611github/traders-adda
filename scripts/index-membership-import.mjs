export const INDEX_MEMBERSHIP_SOURCES = {
  NIFTY50: { url: "https://niftyindices.com/IndexConstituent/ind_nifty50list.csv", min: 50, max: 50 },
  BANKNIFTY: { url: "https://niftyindices.com/IndexConstituent/ind_niftybanklist.csv", min: 14, max: 20 },
  NIFTYIT: { url: "https://niftyindices.com/IndexConstituent/ind_niftyitlist.csv", min: 10, max: 10 },
  NIFTYMIDCAP: { url: "https://niftyindices.com/IndexConstituent/ind_niftymidcap100list.csv", min: 100, max: 100 },
};

export function parseIndexMembers(text, definition) {
  const lines = text.trim().split(/\r?\n/);
  const symbolIndex = lines[0]?.split(",").findIndex((s) => s.trim().toUpperCase() === "SYMBOL");
  if (symbolIndex == null || symbolIndex < 0) throw new Error("Official constituent CSV has no Symbol column.");
  const members = lines.slice(1).map((line) => {
    const fields = line.match(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)?.map((field) =>
      field.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"').trim()) ?? [];
    return fields[symbolIndex];
  });
  if (members.some((s) => !s || !/^[A-Z0-9&.-]+$/.test(s))) throw new Error("Invalid official constituent symbol.");
  if (new Set(members).size !== members.length) throw new Error("Duplicate official constituent symbols.");
  if (members.length < definition.min || members.length > definition.max) {
    throw new Error(`Unexpected constituent count ${members.length}; expected ${definition.min}-${definition.max}.`);
  }
  return members.sort();
}
