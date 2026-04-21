"use client";

import { useEffect, useState } from "react";
import { getLiveTransport, type LiveTransport, type TransportState } from "@/lib/live/transport";
import { getSongStore, type SongStore } from "@/lib/live/store";
import type { Song } from "@/lib/live/model";

export interface UseLiveTransport {
  transport: LiveTransport;
  store: SongStore;
  song: Song;
  state: TransportState;
}

export function useLiveTransport(): UseLiveTransport {
  const [store] = useState(() => getSongStore());
  const [transport] = useState(() => getLiveTransport(store));
  const [song, setSong] = useState<Song>(() => store.getSong());
  const [state, setState] = useState<TransportState>(() => transport.getState());

  useEffect(() => store.subscribe(setSong), [store]);
  useEffect(() => transport.subscribe(setState), [transport]);

  return { transport, store, song, state };
}
