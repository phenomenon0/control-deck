#!/usr/bin/env python3
"""
Run ControlDeckAgent against ONE real OSWorld task via the Docker provider.

Talks to podman through its docker-compat socket, so no Docker daemon
needed. The Ubuntu VM image (~32 GB) lives on the external drive via
the ./docker_vm_data symlink so we don't blow up the system disk.

First run downloads ~12 GB of compressed VM image — patient.

Usage:
    cd benchmarks/osworld
    DOCKER_HOST=unix:///run/user/$(id -u)/podman/podman.sock \\
        .venv/bin/python run_osworld.py \\
        --task /run/media/omen/Storage/osworld/repo/evaluation_examples/examples/os/5ea617a3-0e86-4ba6-aab2-dac9aa2e8d57.json
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path

# Ensure docker SDK uses the podman socket if not already set.
os.environ.setdefault(
    "DOCKER_HOST", f"unix:///run/user/{os.getuid()}/podman/podman.sock"
)

from desktop_env.desktop_env import DesktopEnv

# Bump VM-ready timeout from 300s; cold boot via qemu-in-podman can take a few
# minutes even with bridged networking. (TUN device fix is patched into the
# provider source directly — see provider.py.)
from desktop_env.providers.docker.provider import DockerProvider
DockerProvider._wait_for_vm_ready.__defaults__ = (900,)

from control_deck_agent import ControlDeckAgent, DONE, WAIT, FAIL, SENTINELS


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--task", required=True, help="path to OSWorld task json")
    p.add_argument("--max-steps", type=int, default=15, help="agent step budget")
    p.add_argument("--obs-type", default="screenshot_a11y_tree",
                   choices=["screenshot", "a11y_tree", "screenshot_a11y_tree"])
    p.add_argument("--trace-out", default="trace.json")
    p.add_argument("--headless", action="store_true",
                   help="don't expose VNC; faster but you can't watch")
    args = p.parse_args()

    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(name)s %(levelname)s %(message)s")
    log = logging.getLogger("osworld-runner")

    task = json.load(open(args.task))
    log.info("task=%s instruction=%s", task["id"], task["instruction"])

    log.info("constructing DesktopEnv (first run downloads ~12GB qcow2)...")
    env = DesktopEnv(
        provider_name="docker",
        action_space="pyautogui",
        os_type="Ubuntu",
        headless=args.headless,
        require_a11y_tree=(args.obs_type != "screenshot"),
    )

    log.info("env.reset() — starting VM and applying task config...")
    t0 = time.time()
    obs = env.reset(task_config=task)
    log.info("reset took %.1fs; obs keys=%s", time.time() - t0, list(obs.keys()))

    agent = ControlDeckAgent(observation_type=args.obs_type)

    trace: list[dict] = []
    final_actions: list[str] = []

    for step in range(args.max_steps):
        log.info("--- step %d/%d ---", step + 1, args.max_steps)
        info, actions = agent.predict(task["instruction"], obs)
        log.info("predicted %d action(s); model=%s tokens in/out=%s/%s",
                 len(actions), info["model"], info["input_tokens"], info["output_tokens"])
        for i, a in enumerate(actions):
            kind = "sentinel" if a in SENTINELS else "code"
            snippet = a if len(a) <= 80 else a[:77] + "..."
            log.info("  [%d] %s: %s", i, kind, snippet)

        terminal = False
        for action in actions:
            final_actions.append(action)
            obs, reward, done, step_info = env.step(action)
            log.info("env.step → reward=%s done=%s info=%s",
                     reward, done, step_info if isinstance(step_info, dict) and len(str(step_info)) < 200 else "<...>")
            trace.append({
                "step": step + 1,
                "action": action,
                "reward": reward,
                "done": done,
                "model_tokens": (info["input_tokens"], info["output_tokens"]),
            })
            if action in (DONE, FAIL) or done:
                terminal = True
                break
        if terminal:
            break

    log.info("evaluating task...")
    score = env.evaluate()
    log.info("SCORE = %s", score)

    log.info("closing env...")
    env.close()

    out = {
        "task_id": task["id"],
        "instruction": task["instruction"],
        "score": score,
        "steps_used": len(trace),
        "actions": final_actions,
        "trace": trace,
    }
    Path(args.trace_out).write_text(json.dumps(out, indent=2, default=str))
    log.info("trace written to %s", args.trace_out)

    return 0 if score and score > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
