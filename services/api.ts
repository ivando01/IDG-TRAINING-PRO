const API_URL = "http://localhost:3001";

export async function testBackend() {
  try {
    const res = await fetch(`${API_URL}/`);
    const data = await res.text();
    return data;
  } catch {
    return "Error conectando con backend";
  }
}
