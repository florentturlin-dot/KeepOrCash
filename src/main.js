import "./style.css";

const API_URL = "https://keep-or-cash.vercel.app/api/chat"; // your Vercel endpoint

const app = document.getElementById("app");
app.innerHTML = `
  <div id="chat">
    <div id="messages"></div>
    <div class="controls">
      <input id="userInput" type="text" placeholder="Describe your collectible..." />
      <input id="imageInput" type="file" accept="image/*" />
      <button id="sendBtn">Send</button>
    </div>
  </div>
`;

const messagesDiv = document.getElementById("messages");
const input = document.getElementById("userInput");
const fileInput = document.getElementById("imageInput");
const btn = document.getElementById("sendBtn");

function add(role, text) {
  const p = document.createElement("p");
  p.innerHTML = role === "user" ? `<b>You:</b> ${text}` : `<b>AI:</b> ${text}`;
  messagesDiv.appendChild(p);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => {
      const [prefix, b64] = String(reader.result).split(";base64,");
      const mime = prefix.replace("data:", "");
      resolve({ base64: b64, mime });
    };
    reader.readAsDataURL(file);
  });
}

async function send() {
  const text = input.value.trim();
  const file = fileInput.files?.[0] || null;

  if (!text && !file) {
    add("assistant", "Please type a description or choose an image first.");
    return;
  }

  add("user", text || (file ? `Uploaded image: ${file.name}` : ""));
  input.value = "";
  fileInput.value = "";
  btn.disabled = true;

  try {
    let imagePayload;
    if (file) {
      const { base64, mime } = await readFileAsBase64(file);
      imagePayload = { data: base64, mime };
    }

    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: text ? [{ role: "user", content: text }] : [],
        image: imagePayload
      })
    });
    const data = await res.json();
    add("assistant", data.reply || "Sorry, an error occurred.");
  } catch {
    add("assistant", "Network or upload error.");
  } finally {
    btn.disabled = false;
  }
}

btn.addEventListener("click", send);
input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
