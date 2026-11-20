/**
 * National Coverage Engine for all 36 Nigerian states + FCT (37 jurisdictions),
 * authentic LGAs, representative bounded pilot boxes, and 23 business categories.
 *
 * Implements the GEOGRAPHY × BUSINESS CATEGORY × SOURCE discovery matrix:
 * - Tracks coverage metrics per state, LGA, and category from live D1 data.
 * - Prioritizes poorly covered areas/categories over already-covered hubs.
 * - Enforces scan cooldowns so API quotas are never wasted re-scanning the same cell.
 */
import type { BoundingBox } from './sources/types';

export interface NigeriaStateCoverageRef {
  name: string;
  capital: string;
  zone: 'NW' | 'NE' | 'NC' | 'SW' | 'SE' | 'SS';
  /** Representative capital/hub pilot bounding box (strictly <= 0.2° x 0.2°). */
  pilotBbox: BoundingBox;
  lgas: readonly string[];
}

export const DISCOVERY_CATEGORIES = [
  'Agriculture',
  'Automotive',
  'Beauty',
  'Construction',
  'Education',
  'Finance',
  'Food and Restaurants',
  'Healthcare',
  'Hospitality',
  'Legal Services',
  'Logistics',
  'Manufacturing',
  'Retail',
  'Real Estate',
  'Technology',
  'Professional Services',
  'Repairs',
  'Wholesale',
  'Entertainment',
  'Transportation',
  'Tourism',
  'Local Trades',
  'Other',
] as const;

export type DiscoveryCategory = (typeof DISCOVERY_CATEGORIES)[number];

/** Canonical 36 Nigerian States + Federal Capital Territory (Abuja). */
export const NIGERIA_GEOGRAPHY: readonly NigeriaStateCoverageRef[] = [
  { name: 'Abia', capital: 'Umuahia', zone: 'SE', pilotBbox: { south: 5.50, west: 7.46, north: 5.56, east: 7.53 }, lgas: ['Aba North', 'Aba South', 'Arochukwu', 'Bende', 'Ikwuano', 'Isiala Ngwa North', 'Isiala Ngwa South', 'Isuikwuato', 'Obingwa', 'Ohafia', 'Osisioma', 'Ugwunagbo', 'Ukwa East', 'Ukwa West', 'Umuahia North', 'Umuahia South', 'Umu Nneochi'] },
  { name: 'Adamawa', capital: 'Yola', zone: 'NE', pilotBbox: { south: 9.18, west: 12.44, north: 9.28, east: 12.52 }, lgas: ['Yola North', 'Yola South', 'Mubi North', 'Mubi South', 'Jimeta', 'Girei', 'Numan', 'Michika', 'Gombi'] },
  { name: 'Akwa Ibom', capital: 'Uyo', zone: 'SS', pilotBbox: { south: 5.00, west: 7.89, north: 5.07, east: 7.97 }, lgas: ['Uyo', 'Ikot Ekpene', 'Eket', 'Oron', 'Abak', 'Etinan', 'Ikot Abasi', 'Ibiono-Ibom', 'Ibesikpo Asutan'] },
  { name: 'Anambra', capital: 'Awka', zone: 'SE', pilotBbox: { south: 6.18, west: 7.04, north: 6.25, east: 7.11 }, lgas: ['Awka South', 'Awka North', 'Onitsha North', 'Onitsha South', 'Nnewi North', 'Nnewi South', 'Aguata', 'Idemili North', 'Idemili South', 'Ihiala', 'Ogbaru', 'Oyi'] },
  { name: 'Bauchi', capital: 'Bauchi', zone: 'NE', pilotBbox: { south: 10.28, west: 9.81, north: 10.35, east: 9.88 }, lgas: ['Bauchi', 'Katagum', 'Misau', 'Tafawa Balewa', 'Dass', 'Jamaare', 'Ningi', 'Alkaleri'] },
  { name: 'Bayelsa', capital: 'Yenagoa', zone: 'SS', pilotBbox: { south: 4.90, west: 6.24, north: 4.96, east: 6.31 }, lgas: ['Yenagoa', 'Brass', 'Nembe', 'Ogbia', 'Sagbama', 'Southern Ijaw', 'Ekeremor', 'Kolokuma/Opokuma'] },
  { name: 'Benue', capital: 'Makurdi', zone: 'NC', pilotBbox: { south: 7.70, west: 8.50, north: 7.77, east: 8.58 }, lgas: ['Makurdi', 'Gboko', 'Otukpo', 'Katsina-Ala', 'Gwer East', 'Gwer West', 'Vandeikya'] },
  { name: 'Borno', capital: 'Maiduguri', zone: 'NE', pilotBbox: { south: 11.80, west: 13.11, north: 11.88, east: 13.19 }, lgas: ['Maiduguri', 'Jere', 'Biu', 'Bama', 'Konduga', 'Askira/Uba', 'Monguno'] },
  { name: 'Cross River', capital: 'Calabar', zone: 'SS', pilotBbox: { south: 4.93, west: 8.30, north: 5.00, east: 8.37 }, lgas: ['Calabar Municipal', 'Calabar South', 'Akamkpa', 'Biase', 'Ikom', 'Ogoja', 'Obudu', 'Yakurr'] },
  { name: 'Delta', capital: 'Asaba', zone: 'SS', pilotBbox: { south: 6.17, west: 6.69, north: 6.24, east: 6.76 }, lgas: ['Oshimili South', 'Oshimili North', 'Warri South', 'Warri North', 'Uvwie', 'Sapele', 'Ughelli North', 'Ughelli South', 'Ika North East', 'Ika South'] },
  { name: 'Ebonyi', capital: 'Abakaliki', zone: 'SE', pilotBbox: { south: 6.30, west: 8.08, north: 6.36, east: 8.15 }, lgas: ['Abakaliki', 'Afikpo North', 'Afikpo South', 'Ebonyi', 'Ezza North', 'Ezza South', 'Ikwo', 'Ishielu', 'Ohaozara', 'Ohaukwu'] },
  { name: 'Edo', capital: 'Benin City', zone: 'SS', pilotBbox: { south: 6.30, west: 5.58, north: 6.38, east: 5.66 }, lgas: ['Oredo', 'Ikpoba-Okha', 'Egor', 'Esan Central', 'Esan North-East', 'Esan West', 'Etsako West', 'Etsako Central', 'Uhunmwonde', 'Ovia North-East'] },
  { name: 'Ekiti', capital: 'Ado-Ekiti', zone: 'SW', pilotBbox: { south: 7.59, west: 5.19, north: 7.66, east: 5.26 }, lgas: ['Ado-Ekiti', 'Ikere', 'Ijero', 'Oye', 'Ekiti West', 'Ekiti South-West', 'Irepodun/Ifelodun'] },
  { name: 'Enugu', capital: 'Enugu', zone: 'SE', pilotBbox: { south: 6.41, west: 7.46, north: 6.48, east: 7.54 }, lgas: ['Enugu North', 'Enugu South', 'Enugu East', 'Nsukka', 'Udi', 'Nkanu West', 'Nkanu East', 'Oji River', 'Ezeagu', 'Awgu'] },
  { name: 'FCT', capital: 'Abuja', zone: 'NC', pilotBbox: { south: 9.03, west: 7.45, north: 9.10, east: 7.53 }, lgas: ['Abuja Municipal', 'Bwari', 'Gwagwalada', 'Kuje', 'Kwali', 'Abaji'] },
  { name: 'Gombe', capital: 'Gombe', zone: 'NE', pilotBbox: { south: 10.26, west: 11.13, north: 10.32, east: 11.20 }, lgas: ['Gombe', 'Akko', 'Yamaltu/Deba', 'Kaltungo', 'Billiri', 'Funakaye'] },
  { name: 'Imo', capital: 'Owerri', zone: 'SE', pilotBbox: { south: 5.46, west: 7.00, north: 5.53, east: 7.07 }, lgas: ['Owerri Municipal', 'Owerri North', 'Owerri West', 'Orlu', 'Okigwe', 'Mbaitoli', 'Ikeduru', 'Ngor Okpala', 'Oguta'] },
  { name: 'Jigawa', capital: 'Dutse', zone: 'NW', pilotBbox: { south: 11.68, west: 9.31, north: 11.74, east: 9.38 }, lgas: ['Dutse', 'Hadejia', 'Kazaure', 'Gumel', 'Ringim', 'Birnin Kudu'] },
  { name: 'Kaduna', capital: 'Kaduna', zone: 'NW', pilotBbox: { south: 10.48, west: 7.40, north: 10.56, east: 7.48 }, lgas: ['Kaduna North', 'Kaduna South', 'Chikun', 'Zaria', 'Igabi', 'Jemaa', 'Sabon Gari', 'Giwa', 'Kagarko'] },
  { name: 'Kano', capital: 'Kano', zone: 'NW', pilotBbox: { south: 11.96, west: 8.48, north: 12.04, east: 8.56 }, lgas: ['Kano Municipal', 'Nasarawa', 'Fagge', 'Dala', 'Gwale', 'Tarauni', 'Ungogo', 'Kumbotso', 'Gwarzo', 'Bichi', 'Dawakin Kudu', 'Wudil'] },
  { name: 'Katsina', capital: 'Katsina', zone: 'NW', pilotBbox: { south: 12.96, west: 7.57, north: 13.02, east: 7.64 }, lgas: ['Katsina', 'Daura', 'Funtua', 'Malumfashi', 'Kankia', 'Dutsin Ma', 'Mani', 'Bakori'] },
  { name: 'Kebbi', capital: 'Birnin Kebbi', zone: 'NW', pilotBbox: { south: 12.42, west: 4.16, north: 12.48, east: 4.23 }, lgas: ['Birnin Kebbi', 'Argungu', 'Yauri', 'Zuru', 'Jega', 'Bunza'] },
  { name: 'Kogi', capital: 'Lokoja', zone: 'NC', pilotBbox: { south: 7.77, west: 6.70, north: 7.84, east: 6.77 }, lgas: ['Lokoja', 'Okene', 'Ajaokuta', 'Dekina', 'Idah', 'Kabba/Bunu', 'Ankpa', 'Adavi', 'Yagba West', 'Yagba East', 'Ijumu', 'Kogi (Koton Karfe)', 'Okehi', 'Ofu', 'Olamaboro', 'Omala', 'Bassa', 'Ibaji', 'Igalamela-Odolu', 'Mopa-Muro', 'Ogori/Magongo'] },
  { name: 'Kwara', capital: 'Ilorin', zone: 'NC', pilotBbox: { south: 8.46, west: 4.52, north: 8.53, east: 4.60 }, lgas: ['Ilorin South', 'Ilorin West', 'Ilorin East', 'Offa', 'Omu-Aran', 'Kaiama', 'Moro', 'Edu'] },
  { name: 'Lagos', capital: 'Ikeja', zone: 'SW', pilotBbox: { south: 6.42, west: 3.40, north: 6.46, east: 3.46 }, lgas: ['Agege', 'Alimosho', 'Amuwo-Odofin', 'Apapa', 'Badagry', 'Epe', 'Eti-Osa', 'Ibeju-Lekki', 'Ifako-Ijaiye', 'Ikeja', 'Ikorodu', 'Kosofe', 'Lagos Island', 'Lagos Mainland', 'Mushin', 'Ojo', 'Oshodi-Isolo', 'Shomolu', 'Surulere'] },
  { name: 'Nasarawa', capital: 'Lafia', zone: 'NC', pilotBbox: { south: 8.47, west: 8.49, north: 8.53, east: 8.56 }, lgas: ['Lafia', 'Keffi', 'Akwanga', 'Karu', 'Doma', 'Nasarawa', 'Wamba'] },
  { name: 'Niger', capital: 'Minna', zone: 'NC', pilotBbox: { south: 9.58, west: 6.51, north: 9.65, east: 6.59 }, lgas: ['Chanchaga', 'Bosso', 'Bida', 'Suleja', 'Kontagora', 'Mokwa', 'Lapai', 'Shiroro'] },
  { name: 'Ogun', capital: 'Abeokuta', zone: 'SW', pilotBbox: { south: 7.12, west: 3.31, north: 7.19, east: 3.39 }, lgas: ['Abeokuta South', 'Abeokuta North', 'Ado-Odo/Ota', 'Ijebu Ode', 'Sagamu', 'Ifo', 'Obafemi Owode', 'Ewekoro', 'Ijebu North'] },
  { name: 'Ondo', capital: 'Akure', zone: 'SW', pilotBbox: { south: 7.22, west: 5.16, north: 7.29, east: 5.23 }, lgas: ['Akure South', 'Akure North', 'Ondo West', 'Ondo East', 'Owo', 'Ikare Akoko', 'Okitipupa', 'Idanre'] },
  { name: 'Osun', capital: 'Osogbo', zone: 'SW', pilotBbox: { south: 7.75, west: 4.52, north: 7.82, east: 4.59 }, lgas: ['Osogbo', 'Ilesa East', 'Ilesa West', 'Ife Central', 'Ife East', 'Ede North', 'Ede South', 'Iwo'] },
  { name: 'Oyo', capital: 'Ibadan', zone: 'SW', pilotBbox: { south: 7.35, west: 3.86, north: 7.43, east: 3.94 }, lgas: ['Ibadan North', 'Ibadan North-East', 'Ibadan North-West', 'Ibadan South-West', 'Ibadan South-East', 'Ogbomosho North', 'Ogbomosho South', 'Oyo East', 'Oyo West', 'Iseyin', 'Egbeda', 'Oluyole'] },
  { name: 'Plateau', capital: 'Jos', zone: 'NC', pilotBbox: { south: 9.87, west: 8.85, north: 9.94, east: 8.92 }, lgas: ['Jos North', 'Jos South', 'Jos East', 'Barkin Ladi', 'Mangu', 'Pankshin', 'Shendam', 'Bassa'] },
  { name: 'Rivers', capital: 'Port Harcourt', zone: 'SS', pilotBbox: { south: 4.78, west: 6.97, north: 4.86, east: 7.05 }, lgas: ['Port Harcourt', 'Obio-Akpor', 'Eleme', 'Ikwerre', 'Oyigbo', 'Bonny', 'Okrika', 'Degema', 'Ahoada East', 'Ahoada West', 'Gokana', 'Khana'] },
  { name: 'Sokoto', capital: 'Sokoto', zone: 'NW', pilotBbox: { south: 13.02, west: 5.20, north: 13.09, east: 5.27 }, lgas: ['Sokoto North', 'Sokoto South', 'Wamakko', 'Tambuwal', 'Bodinga', 'Gwadabawa', 'Illela'] },
  { name: 'Taraba', capital: 'Jalingo', zone: 'NE', pilotBbox: { south: 8.86, west: 11.33, north: 8.93, east: 11.40 }, lgas: ['Jalingo', 'Wukari', 'Bali', 'Gashaka', 'Takum', 'Sardauna', 'Zing'] },
  { name: 'Yobe', capital: 'Damaturu', zone: 'NE', pilotBbox: { south: 11.71, west: 11.93, north: 11.78, east: 12.00 }, lgas: ['Damaturu', 'Potiskum', 'Gashua', 'Nguru', 'Geidam', 'Bade', 'Fika'] },
  { name: 'Zamfara', capital: 'Gusau', zone: 'NW', pilotBbox: { south: 12.14, west: 6.63, north: 12.20, east: 6.70 }, lgas: ['Gusau', 'Kaura Namoda', 'Talata Mafara', 'Maru', 'Anka', 'Tsafe', 'Shinkafi'] },
];

export interface StateCoverageMetric {
  state: string;
  capital: string;
  zone: string;
  totalLgasTracked: number;
  lgasWithListings: number;
  memberListings: number;
  discoveredCandidates: number;
  publishedBotListings: number;
  totalAuthenticListings: number;
  coverageGapScore: number;
}

export interface CategoryCoverageMetric {
  category: string;
  memberListings: number;
  discoveredCandidates: number;
  publishedBotListings: number;
  totalAuthenticListings: number;
}

export interface CoveragePriorityCell {
  sourceId: string;
  state: string;
  lga: string;
  category: string;
  pilotBbox: BoundingBox;
  existingCount: number;
  lastScannedAt: number | null;
  priorityScore: number;
}

export function getNigeriaStateRef(stateName: string): NigeriaStateCoverageRef | null {
  const target = stateName.trim().toLowerCase();
  return (
    NIGERIA_GEOGRAPHY.find(
      (s) =>
        s.name.toLowerCase() === target ||
        (target === 'abuja' && s.name === 'FCT'),
    ) ?? null
  );
}

/**
 * Pure priority formula: underserved states/LGAs with zero listings & never scanned
 * receive the highest priority score so the bot naturally expands nationwide instead
 * of hammering Lagos/Abuja repeatedly.
 */
export function computeCoveragePriorityScore(params: {
  existingCount: number;
  lastScannedAt: number | null;
  now: number;
}): number {
  const scarcityScore = 100 / (1 + params.existingCount);
  const stalenessBonus =
    params.lastScannedAt === null
      ? 50
      : Math.min(40, Math.floor((params.now - params.lastScannedAt) / (86_400_000 * 3)));
  return Number((scarcityScore + stalenessBonus).toFixed(2));
}

export async function getNationalCoverageSummary(db: D1Database): Promise<{
  totalStates: number;
  statesCovered: number;
  totalLgasTracked: number;
  lgasCovered: number;
  byState: StateCoverageMetric[];
  byCategory: CategoryCoverageMetric[];
}> {
  const [memberStateRes, discStateRes, memberCatRes, discCatRes, lgaRes] = await Promise.all([
    db
      .prepare(`SELECT state, COUNT(*) AS cnt FROM businesses WHERE status = 'approved' GROUP BY state`)
      .all<{ state: string; cnt: number }>(),
    db
      .prepare(
        `SELECT state,
                COUNT(*) AS discovered_cnt,
                SUM(CASE WHEN lifecycle_status = 'published' AND review_status = 'approved' THEN 1 ELSE 0 END) AS published_cnt
         FROM discovered_businesses
         WHERE state IS NOT NULL AND lifecycle_status NOT IN ('duplicate', 'rejected', 'archived', 'confirmed_closed')
         GROUP BY state`,
      )
      .all<{ state: string; discovered_cnt: number; published_cnt: number }>(),
    db
      .prepare(`SELECT category, COUNT(*) AS cnt FROM businesses WHERE status = 'approved' GROUP BY category`)
      .all<{ category: string; cnt: number }>(),
    db
      .prepare(
        `SELECT category,
                COUNT(*) AS discovered_cnt,
                SUM(CASE WHEN lifecycle_status = 'published' AND review_status = 'approved' THEN 1 ELSE 0 END) AS published_cnt
         FROM discovered_businesses
         WHERE category IS NOT NULL AND lifecycle_status NOT IN ('duplicate', 'rejected', 'archived', 'confirmed_closed')
         GROUP BY category`,
      )
      .all<{ category: string; discovered_cnt: number; published_cnt: number }>(),
    db
      .prepare(
        `SELECT state, lga FROM businesses WHERE status = 'approved' AND lga IS NOT NULL
         UNION
         SELECT state, lga FROM discovered_businesses
         WHERE state IS NOT NULL AND lga IS NOT NULL
           AND lifecycle_status NOT IN ('duplicate', 'rejected', 'archived', 'confirmed_closed')`,
      )
      .all<{ state: string; lga: string }>(),
  ]);

  const memberByState = new Map<string, number>();
  for (const r of memberStateRes.results ?? []) {
    memberByState.set(r.state.toLowerCase(), Number(r.cnt) || 0);
  }
  const discByState = new Map<string, { discovered: number; published: number }>();
  for (const r of discStateRes.results ?? []) {
    discByState.set(r.state.toLowerCase(), {
      discovered: Number(r.discovered_cnt) || 0,
      published: Number(r.published_cnt) || 0,
    });
  }

  const coveredLgasByState = new Map<string, Set<string>>();
  for (const r of lgaRes.results ?? []) {
    const key = r.state.toLowerCase();
    if (!coveredLgasByState.has(key)) coveredLgasByState.set(key, new Set());
    coveredLgasByState.get(key)!.add(r.lga.toLowerCase());
  }

  let statesCovered = 0;
  let totalLgasTracked = 0;
  let lgasCovered = 0;

  const byState: StateCoverageMetric[] = NIGERIA_GEOGRAPHY.map((ref) => {
    const key = ref.name.toLowerCase();
    const memberListings = memberByState.get(key) ?? 0;
    const disc = discByState.get(key) ?? { discovered: 0, published: 0 };
    const totalAuthenticListings = memberListings + disc.published;
    const stateLgaSet = coveredLgasByState.get(key);
    const lgasWithListings = stateLgaSet ? stateLgaSet.size : 0;

    totalLgasTracked += ref.lgas.length;
    lgasCovered += lgasWithListings;
    if (totalAuthenticListings > 0 || disc.discovered > 0) statesCovered += 1;

    return {
      state: ref.name,
      capital: ref.capital,
      zone: ref.zone,
      totalLgasTracked: ref.lgas.length,
      lgasWithListings,
      memberListings,
      discoveredCandidates: disc.discovered,
      publishedBotListings: disc.published,
      totalAuthenticListings,
      coverageGapScore: Number((100 / (1 + totalAuthenticListings + disc.discovered * 0.5)).toFixed(1)),
    };
  }).sort((a, b) => b.coverageGapScore - a.coverageGapScore);

  const memberByCat = new Map<string, number>();
  for (const r of memberCatRes.results ?? []) {
    memberByCat.set(r.category.toLowerCase(), Number(r.cnt) || 0);
  }
  const discByCat = new Map<string, { discovered: number; published: number }>();
  for (const r of discCatRes.results ?? []) {
    discByCat.set(r.category.toLowerCase(), {
      discovered: Number(r.discovered_cnt) || 0,
      published: Number(r.published_cnt) || 0,
    });
  }

  const allCategoryNames = new Set<string>([
    ...DISCOVERY_CATEGORIES,
    ...(memberCatRes.results ?? []).map((r) => r.category),
    ...(discCatRes.results ?? []).map((r) => r.category),
  ]);

  const byCategory: CategoryCoverageMetric[] = Array.from(allCategoryNames)
    .map((cat) => {
      const key = cat.toLowerCase();
      const memberListings = memberByCat.get(key) ?? 0;
      const disc = discByCat.get(key) ?? { discovered: 0, published: 0 };
      return {
        category: cat,
        memberListings,
        discoveredCandidates: disc.discovered,
        publishedBotListings: disc.published,
        totalAuthenticListings: memberListings + disc.published,
      };
    })
    .sort((a, b) => a.totalAuthenticListings - b.totalAuthenticListings);

  return {
    totalStates: NIGERIA_GEOGRAPHY.length,
    statesCovered,
    totalLgasTracked,
    lgasCovered,
    byState,
    byCategory,
  };
}

/**
 * Selects the top-N underserved `(state, lga, category)` cells for a given source while
 * skipping cells scanned within their cooldown window (`next_scan_after > now`).
 */
export async function selectNextUnderservedCells(
  db: D1Database,
  sourceId: string,
  options: {
    limit?: number;
    categories?: readonly string[];
    now?: number;
  } = {},
): Promise<CoveragePriorityCell[]> {
  const limit = Math.min(25, Math.max(1, options.limit ?? 3));
  const now = options.now ?? Date.now();
  const categories = options.categories ?? ['All'];

  const [coverageSummary, scannedCellsRes] = await Promise.all([
    getNationalCoverageSummary(db),
    db
      .prepare(
        `SELECT state, lga, category, discovered_count, last_scanned_at, next_scan_after
         FROM discovery_coverage_cells
         WHERE source_id = ?`,
      )
      .bind(sourceId)
      .all<{
        state: string;
        lga: string;
        category: string;
        discovered_count: number;
        last_scanned_at: number | null;
        next_scan_after: number | null;
      }>(),
  ]);

  const scannedMap = new Map<
    string,
    { discoveredCount: number; lastScannedAt: number | null; nextScanAfter: number | null }
  >();
  for (const row of scannedCellsRes.results ?? []) {
    scannedMap.set(`${row.state.toLowerCase()}|${row.lga.toLowerCase()}|${row.category.toLowerCase()}`, {
      discoveredCount: Number(row.discovered_count) || 0,
      lastScannedAt: row.last_scanned_at,
      nextScanAfter: row.next_scan_after,
    });
  }

  const candidates: CoveragePriorityCell[] = [];
  for (const stateMetric of coverageSummary.byState) {
    const ref = getNigeriaStateRef(stateMetric.state);
    if (!ref) continue;
    // Pick primary LGA (capital/first LGA) per state for bounded pilot sweeps
    const lga = ref.lgas[0] ?? ref.capital;
    for (const cat of categories) {
      const cellKey = `${ref.name.toLowerCase()}|${lga.toLowerCase()}|${cat.toLowerCase()}`;
      const prev = scannedMap.get(cellKey);
      if (prev?.nextScanAfter && prev.nextScanAfter > now) {
        continue; // Respect cooldown window to prevent quota waste
      }
      const existingCount = stateMetric.totalAuthenticListings + (prev?.discoveredCount ?? 0);
      candidates.push({
        sourceId,
        state: ref.name,
        lga,
        category: cat,
        pilotBbox: ref.pilotBbox,
        existingCount,
        lastScannedAt: prev?.lastScannedAt ?? null,
        priorityScore: computeCoveragePriorityScore({
          existingCount,
          lastScannedAt: prev?.lastScannedAt ?? null,
          now,
        }),
      });
    }
  }

  return candidates.sort((a, b) => b.priorityScore - a.priorityScore).slice(0, limit);
}

export async function recordCoverageCellScan(
  db: D1Database,
  params: {
    sourceId: string;
    state: string;
    lga: string;
    category: string;
    discoveredDelta: number;
    publishedDelta?: number;
    cooldownDays?: number;
    now?: number;
  },
): Promise<void> {
  const now = params.now ?? Date.now();
  const cooldownMs = Math.max(1, params.cooldownDays ?? 7) * 86_400_000;
  const nextScanAfter = now + cooldownMs;
  const id = `cov_${params.sourceId}_${params.state}_${params.lga}_${params.category}`
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .slice(0, 120);

  await db
    .prepare(
      `INSERT INTO discovery_coverage_cells (
        id, source_id, state, lga, category,
        discovered_count, published_count, priority_score,
        last_scanned_at, next_scan_after, scan_count, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(source_id, state, lga, category) DO UPDATE SET
        discovered_count = discovered_count + excluded.discovered_count,
        published_count = published_count + excluded.published_count,
        last_scanned_at = excluded.last_scanned_at,
        next_scan_after = excluded.next_scan_after,
        scan_count = scan_count + 1,
        priority_score = MAX(1, 100.0 / (1.0 + discovered_count + excluded.discovered_count)),
        updated_at = excluded.updated_at`,
    )
    .bind(
      id,
      params.sourceId,
      params.state,
      params.lga,
      params.category,
      Math.max(0, params.discoveredDelta),
      Math.max(0, params.publishedDelta ?? 0),
      Math.max(1, 100 / (1 + Math.max(0, params.discoveredDelta))),
      now,
      nextScanAfter,
      now,
    )
    .run();
}
