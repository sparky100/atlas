/**
 * The landscape's colour-by modes (Prompt 7k item 1). Unlike the capability
 * map's `tileColourFor` (`src/ui/capabilityMap/metrics.ts`), a landscape
 * tile *is* a system already — there's no supports-edge aggregation step,
 * the tone comes straight off the system's own recorded attribute.
 *
 * - **Criticality**: the same ordered `low < medium < high < critical`
 *   value and tone table `criticalityTone.ts` already gives the element
 *   page and the capability map's own worst-of aggregate — no separate
 *   vocabulary invented here.
 * - **Hosting model**: a closed, *unordered* set
 *   (on-prem/private-cloud/public-cloud/SaaS/hybrid) — there's no "worst"
 *   hosting model, so every recorded value gets the same `info` tone. The
 *   colour exists to make "is this recorded at all, and does it vary
 *   across the estate" visible at a glance; the actual value is read from
 *   the label (canvas hover tooltip), never the colour alone (§8.7).
 * - **Domain (IT/OT)**, Prompt 7k item 3: unlike the two modes above, this
 *   one is never silent — `domainOf` defaults an unrecorded system to
 *   `'it'`, so every tile gets a tone (`systemDomain.ts`'s own
 *   `DOMAIN_TONE`). This is the same fact the landscape's OT zone
 *   (`layout.ts`'s `OT_ZONE_LANE_KEY`) already groups structurally — the
 *   colour-by mode is the complementary, always-available way to see the
 *   same fact on every tile, not a duplicate mechanism.
 */
import type { HostingModel } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { LandscapeColourByMode } from '../../contracts/userPreferences';
import type { ChipTone } from '../components/Chip/Chip';
import { attributesRecord } from '../elements/attributesRecord';
import { criticalityToneFor } from '../elements/criticalityTone';
import { domainOf, domainToneFor } from '../elements/systemDomain';

export interface TileColour {
  tone: ChipTone | undefined;
  label: string | undefined;
}

export const LANDSCAPE_COLOUR_BY_OPTIONS: { value: LandscapeColourByMode; label: string }[] = [
  { value: 'metric:criticality', label: 'Criticality' },
  { value: 'metric:hostingModel', label: 'Hosting model' },
  { value: 'metric:domain', label: 'IT/OT domain' },
];

const HOSTING_MODEL_LABEL: Record<HostingModel, string> = {
  on_premises: 'on-premises',
  private_cloud: 'private cloud',
  public_cloud: 'public cloud',
  saas: 'SaaS',
  hybrid: 'hybrid',
};

/** The tone+label a landscape tile should show for the selected colour-by mode — `mode: 'none'` (or an actor, which carries neither attribute) always returns no tone and no label, same "always show the value alongside the colour" shape `tileColourFor` uses. */
export function landscapeTileColourFor(mode: LandscapeColourByMode, system: ElementsHeadRow): TileColour {
  switch (mode) {
    case 'none':
      return { tone: undefined, label: undefined };
    case 'metric:criticality': {
      const value = attributesRecord(system.attributes).criticality;
      if (typeof value !== 'string') return { tone: undefined, label: undefined };
      return { tone: criticalityToneFor(value), label: value };
    }
    case 'metric:hostingModel': {
      const value = attributesRecord(system.attributes).hostingModel;
      if (typeof value !== 'string' || !(value in HOSTING_MODEL_LABEL)) return { tone: undefined, label: undefined };
      return { tone: 'info', label: HOSTING_MODEL_LABEL[value as HostingModel] };
    }
    case 'metric:domain': {
      const domain = domainOf(system);
      // Domain is a fact, not a risk, so chips show it neutral everywhere — but this colour-by mode exists to tell IT from OT apart, so non-IT tiles read blue (informational), never amber/red.
      return { tone: domain === 'it' ? domainToneFor(domain) : 'info', label: domain };
    }
  }
}
