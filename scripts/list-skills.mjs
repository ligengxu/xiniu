const res = await fetch("http://localhost:3000/api/skills/manage");
const data = await res.json();
console.log("Total:", data.skills.length);
const userSkills = data.skills.filter(s => s.source === "user");
console.log("User skills:", userSkills.length);
console.log("\nAll skills:");
data.skills.forEach((s, i) => console.log(`${i+1}. [${s.source}] ${s.name} - ${s.displayName}`));
