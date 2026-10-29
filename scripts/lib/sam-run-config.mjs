const ALLOWED_ARGUMENTS = new Set([
  "--clip=hero",
  "--clip=heldout-02",
  "--fps=10",
  "--fps=15",
  "--prompt=animal",
  "--prompt=antelope",
  "--prompt=baboon",
  "--prompt=hippo",
  "--prompt=hippopotamus",
]);

export function resolveSamRunConfig(argumentsList) {
  const unknownArguments = argumentsList.filter(
    (argument) => !ALLOWED_ARGUMENTS.has(argument),
  );
  const clipArguments = argumentsList.filter((argument) => argument.startsWith("--clip="));
  const fpsArguments = argumentsList.filter((argument) => argument.startsWith("--fps="));
  const promptArguments = argumentsList.filter((argument) => argument.startsWith("--prompt="));
  if (
    unknownArguments.length > 0 ||
    clipArguments.length > 1 ||
    fpsArguments.length > 1 ||
    promptArguments.length > 1
  ) {
    throw new Error(
      "Usage: node scripts/meta-feasibility.mjs [--clip=hero|--clip=heldout-02] [--fps=10|--fps=15] [--prompt=animal|antelope|baboon|hippo|hippopotamus]",
    );
  }

  const clipId = clipArguments[0]?.split("=")[1] ?? "hero";
  const analysisFps = Number(fpsArguments[0]?.split("=")[1] ?? 10);
  const prompt = promptArguments[0]?.split("=")[1] ?? "animal";

  if (clipId === "heldout-02") {
    if (analysisFps !== 10 || prompt !== "animal") {
      throw new Error("Held-out evaluation is locked to the animal prompt at 10 fps.");
    }
    return {
      clipId,
      analysisFps,
      prompt,
      mediaFileName: "heldout-02-analysis-10fps.mp4",
      runsRoot: "private/model-evaluation/heldout-02",
      runPurpose: "held_out_evaluation",
    };
  }

  if (prompt !== "animal" && analysisFps !== 15) {
    throw new Error("Targeted recall experiments must use the approved 15 fps derivative.");
  }
  return {
    clipId,
    analysisFps,
    prompt,
    mediaFileName: `clip-01-analysis-${analysisFps}fps.mp4`,
    runsRoot:
      prompt !== "animal"
        ? `private/model-experiments/sam-targeted-recall/${prompt}`
        : analysisFps === 10
          ? "private/model-runs"
          : "private/model-experiments/sam-temporal-15fps",
    runPurpose:
      prompt !== "animal"
        ? "targeted_recall_experiment"
        : analysisFps === 10
          ? "hero_feasibility"
          : "temporal_sampling_experiment",
  };
}
