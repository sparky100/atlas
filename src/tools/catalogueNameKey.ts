/** Name keys for matching one product against another. No imports, so the product finder function can bundle it cheaply. */

export function words(value: string): string[] {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((word) => word !== '');
}

/** A product's name without a leading vendor name, in lower-case words: "Esri ArcGIS Utility Network" by Esri and "ArcGIS Utility Network" give the same key. */
export function productNameKey(vendor: string, product: string): string {
  const name = words(product);
  const lead = words(vendor);
  const hasLead = lead.length > 0 && name.length > lead.length && lead.every((word, index) => name[index] === word);
  return (hasLead ? name.slice(lead.length) : name).join(' ');
}

export function vendorKey(vendor: string): string {
  return words(vendor).join(' ');
}
