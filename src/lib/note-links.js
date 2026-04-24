export const extractWikiLinks = (html) => {
  const m = [...html.matchAll(/\[\[([^\]]+)\]\]/g)].map((x) => x[1].trim()).filter(Boolean);
  return [...new Set(m)].slice(0, 64);
};

