/**
 * Skill registry — joins loader output with per-skill invocation stats.
 * Thin wrapper, lives separately so the loader can stay pure-fs and the
 * registry layer can pull in DB reads.
 */

import { loadSkills, loadSkill } from "./loader";
import type { Skill } from "./schema";
import { getInvocationStats } from "@/lib/agui/db";

export interface SkillWithStats extends Skill {
  stats: {
    count: number;
    errors: number;
    lastInvokedAt: string | null;
    avgDurationMs: number | null;
  };
}

function emptyStats(): SkillWithStats["stats"] {
  return { count: 0, errors: 0, lastInvokedAt: null, avgDurationMs: null };
}

export function listSkills(): SkillWithStats[] {
  const skills = loadSkills();
  const statsMap = new Map(getInvocationStats("skill").map((s) => [s.targetId, s]));
  return skills.map((skill) => {
    const stat = statsMap.get(skill.id);
    return {
      ...skill,
      stats: stat
        ? {
            count: stat.count,
            errors: stat.errors,
            lastInvokedAt: stat.lastInvokedAt,
            avgDurationMs: stat.avgDurationMs,
          }
        : emptyStats(),
    };
  });
}

export function getSkillWithStats(id: string): SkillWithStats | null {
  const skill = loadSkill(id);
  if (!skill) return null;
  const statsMap = new Map(getInvocationStats("skill").map((s) => [s.targetId, s]));
  const stat = statsMap.get(id);
  return {
    ...skill,
    stats: stat
      ? {
          count: stat.count,
          errors: stat.errors,
          lastInvokedAt: stat.lastInvokedAt,
          avgDurationMs: stat.avgDurationMs,
        }
      : emptyStats(),
  };
}
