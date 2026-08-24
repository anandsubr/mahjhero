import SkillTierPips from './SkillTierPips';
import type { SkillLevel } from '../lib/profile';

type Props = {
  level: SkillLevel;
  color?: string;
};

/**
 * The pip glyph for a PERSON's skill level -- never a table's tier.
 *
 * A thin wrapper over `SkillTierPips` that narrows its prop from `SkillTier`
 * (`'beginner' | 'intermediate' | 'advanced' | 'mixed'`) to `SkillLevel`
 * (`'beginner' | 'intermediate' | 'advanced'`), which cannot express
 * `'mixed'` at all. That narrowing is the point: a table can be mixed, a
 * person cannot (the parent spec's own reason `skill_tier` and `skill_level`
 * are separate types), so a caller that means "this member's level" should
 * be structurally unable to reach the dash. Before this wrapper existed, any
 * caller could hand `SkillTierPips` a bare `SkillTier` and the type checker
 * would happily accept `'mixed'` for a person -- a hazard worth designing
 * out, not just commenting around.
 *
 * `profiles.skill_level` is nullable, and null means "not set", which is
 * NOT the same thing `mixed` means for a table ("all levels welcome"). This
 * component takes a `SkillLevel`, not `SkillLevel | null`, on purpose: a
 * caller with a possibly-null level (SkillLevelPicker.tsx,
 * app/clubs/[id]/index.tsx's roster) must check for null itself and render
 * nothing at all in that case, rather than this component inventing a
 * fourth visual state nobody asked for.
 */
export default function SkillLevelPips({ level, color }: Props) {
  return <SkillTierPips tier={level} color={color} />;
}
