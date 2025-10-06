const shapes = {
  O: "◉",
  S: "▧",
  W: "/\/\",
};

const cards = [
  { shape: "O", color: "R", number: 1 },
  { shape: "O", color: "R", number: 2 },
  { shape: "O", color: "R", number: 3 },
  { shape: "S", color: "G", number: 1 },
  { shape: "S", color: "G", number: 2 },
  { shape: "S", color: "G", number: 3 },
  { shape: "W", color: "B", number: 1 },
  { shape: "W", color: "B", number: 2 },
  { shape: "W", color: "B", number: 3 },
  { shape: "O", color: "G", number: 2 },
  { shape: "S", color: "R", number: 3 },
  { shape: "W", color: "R", number: 1 },
];

const colorMap = {
  R: "#ff0000",
  G: "#00ff00",
  B: "#00aaff",
};

const board = document.getElementById("board");
const message = document.getElementById("message");
let selected = [];

function asciiCard(card) {
  const shape = shapes[card.shape];
  const coloredShape = `<span class="shape" style="color:${colorMap[card.color]}">${shape}</span>`;
  const line = " " + Array(card.number).fill(coloredShape).join(" ") + " ";
  const pad = " ".repeat(Math.max(0, 7 - line.length / 2));
  return `+---------+
|${line}${pad}|
|         |
|         |
+---------+
(${card.color})`;
}

function drawCard(card, index) {
  const el = document.createElement("pre");
  el.className = "card";
  el.innerHTML = asciiCard(card);
  el.onclick = () => selectCard(index, el);
  board.appendChild(el);
}

function selectCard(index, el) {
  if (selected.includes(index)) {
    selected = selected.filter((i) => i !== index);
    el.classList.remove("selected");
  } else {
    selected.push(index);
    el.classList.add("selected");
  }
  if (selected.length === 3) checkSet();
}

function checkSet() {
  const [a, b, c] = selected.map((i) => cards[i]);
  const props = ["shape", "color", "number"];
  const isSet = props.every((p) => {
    const vals = [a[p], b[p], c[p]];
    return new Set(vals).size !== 2;
  });
  message.innerText = isSet ? "✅ That’s a Set!" : "❌ Not a Set.";
  selected = [];
  document.querySelectorAll(".card").forEach((c) => c.classList.remove("selected"));
}

cards.forEach(drawCard);
