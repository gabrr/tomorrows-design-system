import { useEffect } from "react";
import { Play, Pause, SkipBack, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, IconAction, Slider, Select, Numeric, Text } from "../../ui";
import { workspace, useWorkspace } from "../../workspace/store";
import { fmt } from "../../domain/evidence.js";
import { sampledTraffic } from "../../domain/graph";
export function Playback() {
  const s = useWorkspace(),
    frames = s.run?.frames || [],
    frame = frames[s.frame],
    fresh = s.runRevision === s.revision,
    sample = sampledTraffic(frames, s.frame, fresh).interval;
  useEffect(() => {
    if (!s.playing || !s.run) return;
    let last = performance.now(),
      accumulator = 0,
      id = 0;
    const tick = (now: number) => {
      const current = workspace.get(),
        list = current.run?.frames;
      if (!current.playing || !list) return;
      accumulator += ((now - last) / 1000) * current.speed;
      last = now;
      let index = current.frame;
      while (
        index < list.length - 1 &&
        accumulator >= Math.max(0.001, list[index + 1].time - list[index].time)
      ) {
        accumulator -= Math.max(0.001, list[index + 1].time - list[index].time);
        index++;
      }
      if (index !== current.frame) workspace.set({ frame: index });
      if (index === list.length - 1) {
        workspace.set({ playing: false });
        return;
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [s.playing, s.run]);
  if (!s.run) return null;
  return (
    <Card className="playback-dock" padding={2}>
      <div className="row">
        <IconAction
          label="Restart playback"
          icon={<SkipBack size={16} />}
          onClick={() => workspace.seek(0)}
        />
        <IconAction
          label={s.playing ? "Pause simulation" : "Play simulation"}
          icon={s.playing ? <Pause size={16} /> : <Play size={16} />}
          onClick={() => {
            if (s.frame === frames.length - 1 && !s.playing)
              workspace.set({ frame: 0 });
            workspace.set({ playing: !s.playing });
          }}
        />
        <IconAction
          label="Previous frame"
          icon={<ChevronLeft size={16} />}
          disabled={s.frame === 0}
          onClick={() => workspace.seek(s.frame - 1)}
        />
        <IconAction
          label="Next frame"
          icon={<ChevronRight size={16} />}
          disabled={s.frame === frames.length - 1}
          onClick={() => workspace.seek(s.frame + 1)}
        />
        <div className="playback-time">
          <Text>
            {fresh ? "Replay" : "Previous run"}{" "}
            {s.playing ? "playing" : "paused"} · {fmt(frame?.time ?? 0)} /{" "}
            {s.run.duration}s
          </Text>
          <Text type="supporting">
            {!fresh
              ? "Graph rates unavailable · rerun required"
              : sample
                ? `Rates: ${fmt(sample.from, 3)}–${fmt(sample.to, 3)}s sample`
                : "Rates unavailable · no prior interval"}
          </Text>
        </div>
        <div className="playback-range">
          <Slider
            label="Simulation time"
            isLabelHidden
            value={s.frame}
            min={0}
            max={Math.max(1, frames.length - 1)}
            step={1}
            onChange={(v: number | [number, number]) =>
              workspace.seek(Array.isArray(v) ? v[0] : v)
            }
            valueDisplay="none"
            formatValue={(i) => `${frames[i]?.time ?? 0} simulated seconds`}
          />
        </div>
        <div className="playback-number">
          <Numeric
            label="Selected simulated time · seconds"
            isLabelHidden
            value={frame?.time ?? 0}
            min={0}
            max={s.run.duration}
            onChange={workspace.seekTime}
            isWheelEnabled={false}
          />
        </div>
        <div className="playback-speed">
          <Select
            label="Playback speed"
            isLabelHidden
            value={String(s.speed)}
            onChange={(v) => workspace.set({ speed: Number(v) })}
            options={["0.5", "1", "2", "4"].map((v) => ({
              value: v,
              label: v + "×",
            }))}
            presentation="popover"
          />
        </div>
      </div>
    </Card>
  );
}
