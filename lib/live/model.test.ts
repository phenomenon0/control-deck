/**
 * Live model + store + importer tests.
 * Run with: bun test lib/live/model.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
  createAudioClip,
  createChannel,
  createFxSpec,
  createInsert,
  createLaunchGroup,
  createPattern,
  createPatternClip,
  createSong,
  deserializeSong,
  newId,
  serializeSong,
} from "./model";
import { SongStore } from "./store";
import { importLiveScript } from "./importer";

describe("model factories", () => {
  test("createSong has empty collections + sane defaults", () => {
    const s = createSong();
    expect(s.channels).toEqual([]);
    expect(s.patterns).toEqual([]);
    expect(s.playlist.clips).toEqual([]);
    expect(s.mixer).toEqual([]);
    expect(s.launchGroups).toEqual([]);
    expect(s.bpm).toBe(120);
    expect(s.timeSigNum).toBe(4);
    expect(s.id).toBeTruthy();
  });

  test("factories set required fields", () => {
    const ch = createChannel("drum", "kick");
    expect(ch.id).toBeTruthy();
    expect(ch.kind).toBe("drum");
    expect(ch.name).toBe("kick");
    expect(ch.insertId).toBeNull();

    const p = createPattern("main");
    expect(p.lengthBars).toBe(1);
    expect(p.stepDiv).toBe("16n");
    expect(p.slices).toEqual({});

    const ins = createInsert();
    expect(ins.fx).toEqual([]);

    const pc = createPatternClip({ patternId: "p1", lane: 0, startBar: 0, lengthBars: 4 });
    expect(pc.kind).toBe("pattern");
    expect(pc.patternId).toBe("p1");

    const ac = createAudioClip({ lane: 1, startBar: 0, lengthBars: 2 });
    expect(ac.kind).toBe("audio");
    expect(ac.gainDb).toBe(0);

    const g = createLaunchGroup();
    expect(g.quantize).toBe("bar");

    const fx = createFxSpec("builtin:reverb", { size: 0.5 }, 0.6);
    expect(fx.wet).toBe(0.6);
    expect(fx.bypassed).toBe(false);
  });

  test("newId produces unique strings", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 32; i++) ids.add(newId());
    expect(ids.size).toBe(32);
  });
});

describe("SongStore", () => {
  test("subscribe emits initial state and every mutation", () => {
    const store = new SongStore();
    const snapshots: number[] = [];
    store.subscribe((s) => { snapshots.push(s.channels.length); });
    store.addChannel("drum", "kick");
    store.addChannel("synth", "bass");
    expect(snapshots).toEqual([0, 1, 2]);
  });

  test("addChannel + patchChannel + removeChannel", () => {
    const store = new SongStore();
    const id = store.addChannel("drum", "kick");
    expect(store.getSong().channels).toHaveLength(1);
    store.patchChannel(id, { gainDb: -3, muted: true });
    expect(store.getSong().channels[0].gainDb).toBe(-3);
    expect(store.getSong().channels[0].muted).toBe(true);
    store.removeChannel(id);
    expect(store.getSong().channels).toEqual([]);
  });

  test("removeChannel drops its slice from every pattern", () => {
    const store = new SongStore();
    const ch = store.addChannel("drum", "kick");
    const p1 = store.addPattern("a");
    const p2 = store.addPattern("b");
    store.setPatternSlice(p1, ch, ["bd", null, "bd", null]);
    store.setPatternSlice(p2, ch, ["bd", "bd"]);
    store.removeChannel(ch);
    for (const p of store.getSong().patterns) {
      expect(p.slices[ch]).toBeUndefined();
    }
  });

  test("addPatternClip throws if pattern missing", () => {
    const store = new SongStore();
    expect(() => store.addPatternClip("nope", 0, 0, 4)).toThrow();
  });

  test("removePattern drops any PatternClip referencing it", () => {
    const store = new SongStore();
    const p = store.addPattern("main");
    store.addPatternClip(p, 0, 0, 4);
    store.addPatternClip(p, 1, 4, 4);
    expect(store.getSong().playlist.clips).toHaveLength(2);
    store.removePattern(p);
    expect(store.getSong().playlist.clips).toEqual([]);
    expect(store.getSong().patterns).toEqual([]);
  });

  test("removeInsert unroutes every channel pointing at it", () => {
    const store = new SongStore();
    const ch1 = store.addChannel("drum");
    const ch2 = store.addChannel("synth");
    const ins = store.addInsert();
    store.routeChannelToInsert(ch1, ins);
    store.routeChannelToInsert(ch2, ins);
    store.removeInsert(ins);
    for (const c of store.getSong().channels) {
      expect(c.insertId).toBeNull();
    }
  });

  test("fx mutation: add, wet, param, bypass, remove", () => {
    const store = new SongStore();
    const ins = store.addInsert();
    const fxId = store.addBuiltinFx(ins, "reverb", 0.4);
    expect(store.getSong().mixer[0].fx[0].wet).toBe(0.4);
    store.setFxWet(ins, fxId, 0.9);
    expect(store.getSong().mixer[0].fx[0].wet).toBe(0.9);
    store.setFxParam(ins, fxId, "decay", 3.5);
    expect(store.getSong().mixer[0].fx[0].params.decay).toBe(3.5);
    store.setFxBypass(ins, fxId, true);
    expect(store.getSong().mixer[0].fx[0].bypassed).toBe(true);
    store.removeFx(ins, fxId);
    expect(store.getSong().mixer[0].fx).toEqual([]);
  });

  test("moveClip + resizeClip respect minimums", () => {
    const store = new SongStore();
    const p = store.addPattern("main");
    const id = store.addPatternClip(p, 0, 0, 4);
    store.moveClip(id, 3, -10);
    const clip = store.getSong().playlist.clips.find((c) => c.id === id)!;
    expect(clip.lane).toBe(3);
    expect(clip.startBar).toBe(0);
    store.resizeClip(id, 0);
    expect(store.getSong().playlist.clips.find((c) => c.id === id)!.lengthBars).toBeGreaterThan(0);
  });

  test("setBpm clamps to 40..300", () => {
    const store = new SongStore();
    store.setBpm(10);
    expect(store.getSong().bpm).toBe(40);
    store.setBpm(500);
    expect(store.getSong().bpm).toBe(300);
  });

  test("every mutation produces a new Song object (referential change)", () => {
    const store = new SongStore();
    const snapshots: object[] = [];
    store.subscribe((s) => { snapshots.push(s); });
    store.addChannel("drum");
    store.setBpm(140);
    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i]).not.toBe(snapshots[i - 1]);
    }
  });
});

describe("serialization round-trip", () => {
  test("empty song round-trips", () => {
    const before = createSong("Empty");
    const after = deserializeSong(serializeSong(before));
    expect(after).toEqual(before);
  });

  test("fully populated song round-trips", () => {
    const store = new SongStore();
    store.setBpm(140);
    const ch = store.addChannel("drum", "kick");
    const ins = store.addInsert();
    store.routeChannelToInsert(ch, ins);
    store.addBuiltinFx(ins, "reverb", 0.5);
    const p = store.addPattern("main");
    store.setPatternSlice(p, ch, ["bd", null, "bd", null]);
    store.addPatternClip(p, 0, 0, 4);
    store.addAudioClip({
      lane: 1,
      startBar: 0,
      lengthBars: 2,
      generation: { prompt: "pad", duration: 6, loader: "stable-audio", status: "pending" },
    });
    const g = store.addLaunchGroup("Scene A");
    store.addLaunchTrigger(g, { kind: "pattern", patternId: p });

    const before = store.getSong();
    const after = deserializeSong(serializeSong(before));
    expect(after).toEqual(before);
  });

  test("rejects unknown schema version", () => {
    expect(() =>
      deserializeSong(JSON.stringify({ schema: 999, song: createSong() })),
    ).toThrow(/schema/i);
  });
});

describe("importer (script → Song)", () => {
  const script = `bpm 124
0 kick: bd ~ bd ~ bd ~ bd ~
1 snare: ~ ~ sd ~ ~ ~ sd ~
2 hats: hh*8
3 bass: c2 ~ eb2 ~ g2 ~ bb2 ~
fx 0: distortion 0.16 > reverb 0.12
fx 3: filter 0.45 > delay 0.18
sample 6 texture: duration=6 loader=stable-audio prompt="dusty tape air loop"
`;

  test("produces channels, a single pattern, a clip, inserts, and an audio clip", () => {
    const store = new SongStore();
    const result = importLiveScript(store, script);
    const song = store.getSong();

    expect(result.errors).toEqual([]);
    expect(song.bpm).toBe(124);
    // 4 step-tracks (0..3) + 1 sample-track (6) = 5 channels
    expect(song.channels).toHaveLength(5);
    expect(song.patterns).toHaveLength(1);
    expect(Object.keys(song.patterns[0].slices)).toHaveLength(4);
    expect(song.mixer).toHaveLength(2);
    const patternClips = song.playlist.clips.filter((c) => c.kind === "pattern");
    const audioClips = song.playlist.clips.filter((c) => c.kind === "audio");
    expect(patternClips).toHaveLength(1);
    expect(audioClips).toHaveLength(1);
    expect(audioClips[0].kind).toBe("audio");
    if (audioClips[0].kind === "audio") {
      expect(audioClips[0].generation?.prompt).toMatch(/tape air/);
      expect(audioClips[0].generation?.status).toBe("pending");
    }
  });

  test("channels routed to their inserts when fx chains present", () => {
    const store = new SongStore();
    const result = importLiveScript(store, script);
    const song = store.getSong();

    for (const tn of [0, 3] as const) {
      const chId = result.channelIds[tn];
      const insertId = result.insertIds[tn];
      expect(chId).toBeTruthy();
      expect(insertId).toBeTruthy();
      const ch = song.channels.find((c) => c.id === chId)!;
      expect(ch.insertId).toBe(insertId);
    }
  });

  test("import is idempotent — reimporting resets the song", () => {
    const store = new SongStore();
    importLiveScript(store, script);
    const firstId = store.getSong().id;
    importLiveScript(store, script);
    const second = store.getSong();
    expect(second.id).not.toBe(firstId);
    expect(second.channels).toHaveLength(5);
    expect(second.patterns).toHaveLength(1);
  });
});
