const key = process.env.MODEL_API_KEY;

if (typeof key !== "string" || key.trim().length < 12) {
  console.error("MODEL_API_KEY is missing or too short.");
  process.exitCode = 1;
} else {
  console.log("MODEL_API_KEY is present. Its value was not printed.");
}
