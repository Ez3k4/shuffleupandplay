/** Small, searchable starting token catalog. IDs are the only values accepted from clients. */
export type TokenPreset = {
  id: string
  name: string
  typeLine: string
  power?: string
  toughness?: string
  color: string
  glyph: string
}

export const TOKEN_PRESETS: readonly TokenPreset[] = [
  { id: "treasure", name: "Treasure", typeLine: "Token Artifact — Treasure", color: "#b38d37", glyph: "◆" },
  { id: "food", name: "Food", typeLine: "Token Artifact — Food", color: "#61935a", glyph: "●" },
  { id: "clue", name: "Clue", typeLine: "Token Artifact — Clue", color: "#8b91a8", glyph: "◇" },
  { id: "blood", name: "Blood", typeLine: "Token Artifact — Blood", color: "#bd5e5e", glyph: "♦" },
  { id: "map", name: "Map", typeLine: "Token Artifact — Map", color: "#c4a673", glyph: "⌖" },
  { id: "gold", name: "Gold", typeLine: "Token Artifact — Gold", color: "#d0b453", glyph: "⬡" },
  { id: "soldier", name: "Soldier", typeLine: "Token Creature — Soldier", power: "1", toughness: "1", color: "#d0c4a5", glyph: "⚔" },
  { id: "goblin", name: "Goblin", typeLine: "Token Creature — Goblin", power: "1", toughness: "1", color: "#b55d42", glyph: "♠" },
  { id: "elf-warrior", name: "Elf Warrior", typeLine: "Token Creature — Elf Warrior", power: "1", toughness: "1", color: "#5c986a", glyph: "✤" },
  { id: "saproling", name: "Saproling", typeLine: "Token Creature — Saproling", power: "1", toughness: "1", color: "#719d49", glyph: "❧" },
  { id: "spirit", name: "Spirit", typeLine: "Token Creature — Spirit (Flying)", power: "1", toughness: "1", color: "#90adc4", glyph: "✧" },
  { id: "thopter", name: "Thopter", typeLine: "Token Artifact Creature — Thopter (Flying)", power: "1", toughness: "1", color: "#7a9ea8", glyph: "✈" },
  { id: "zombie", name: "Zombie", typeLine: "Token Creature — Zombie", power: "2", toughness: "2", color: "#8a83a7", glyph: "☠" },
  { id: "beast", name: "Beast", typeLine: "Token Creature — Beast", power: "3", toughness: "3", color: "#809750", glyph: "♞" },
] as const

export function tokenPreset(id: string): TokenPreset | undefined {
  return TOKEN_PRESETS.find((candidate) => candidate.id === id)
}

/** Self-contained original token art. Avoid external services and card-art licensing. */
export function tokenImageUrl(preset: TokenPreset): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 440">
    <rect width="320" height="440" fill="#141b20"/>
    <rect x="13" y="13" width="294" height="414" rx="16" fill="${preset.color}" opacity=".22" stroke="${preset.color}" stroke-width="5"/>
    <circle cx="160" cy="196" r="102" fill="${preset.color}" opacity=".35"/>
    <text x="160" y="228" text-anchor="middle" fill="#fff8dc" font-size="114" font-family="sans-serif">${preset.glyph}</text>
    <text x="160" y="360" text-anchor="middle" fill="#fff8dc" font-size="25" font-weight="bold" font-family="sans-serif">TOKEN</text>
  </svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
