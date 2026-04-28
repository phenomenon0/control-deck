"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function useUrlTab<T extends string>(
  tabs: readonly { id: T }[],
  defaultTab: T,
) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const rawTab = params.get("tab");
  const active = tabs.find((tab) => tab.id === rawTab)?.id ?? defaultTab;

  const setTab = useCallback(
    (id: T) => {
      const sp = new URLSearchParams(params.toString());
      if (id === defaultTab) {
        sp.delete("tab");
      } else {
        sp.set("tab", id);
      }

      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [defaultTab, params, pathname, router],
  );

  return { active, pathname, params, rawTab, router, setTab };
}
