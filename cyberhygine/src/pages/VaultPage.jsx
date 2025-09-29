import React, { useState, useEffect } from "react";
import Navbar from "../components/Navbar";
import zxcvbn from "zxcvbn";
import axios from "axios";
import API_BASE_URL from "../config";

// Password strength checker using zxcvbn
function getPasswordStrength(password) {
  const result = zxcvbn(password);
  const score = result.score;
  if (score <= 1) return "weak";
  if (score === 2) return "medium";
  return "strong";
}

const strengthColors = {
  weak: "bg-red-600",
  medium: "bg-yellow-600",
  strong: "bg-green-600"
};

const VaultPage = () => {
  const [credentials, setCredentials] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ site: "", username: "", password: "", strength: "medium" });
  const [zxcvbnResult, setZxcvbnResult] = useState(zxcvbn(""));
  const [error, setError] = useState("");

  useEffect(() => {
    // Fetch credentials from backend
    axios.get(`${API_BASE_URL}/credentials`).then(res => {
      setCredentials(res.data);
    });
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    let updatedForm = { ...form, [name]: value };
    if (name === "password") {
      const result = zxcvbn(value);
      updatedForm.strength = getPasswordStrength(value);
      setZxcvbnResult(result);
    }
    setForm(updatedForm);
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await axios.post(`${API_BASE_URL}/credentials`, form);
      // Refresh credentials list
      const res = await axios.get(`${API_BASE_URL}/credentials`);
      setCredentials(res.data);
      setShowAdd(false);
      setForm({ site: "", username: "", password: "", strength: "medium" });
      setZxcvbnResult(zxcvbn(""));
    } catch (err) {
      setError("Failed to add credential.");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-blue-900">
      <Navbar />
      <div className="max-w-3xl mx-auto py-8 px-4">
        <h2 className="text-3xl font-bold text-white mb-6">Password Vault</h2>
        <button
          className="mb-4 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
          onClick={() => setShowAdd(true)}
        >
          Add Credential
        </button>
        {showAdd && (
          <form onSubmit={handleAdd} className="bg-white/10 rounded-xl p-6 mb-6">
            <div className="mb-4">
              <label className="block text-white mb-1">Site</label>
              <input name="site" value={form.site} onChange={handleChange} required className="w-full px-3 py-2 rounded bg-white/20 text-white" />
            </div>
            <div className="mb-4">
              <label className="block text-white mb-1">Username</label>
              <input name="username" value={form.username} onChange={handleChange} required className="w-full px-3 py-2 rounded bg-white/20 text-white" />
            </div>
            <div className="mb-4">
              <label className="block text-white mb-1">Password</label>
              <input name="password" value={form.password} onChange={handleChange} required className="w-full px-3 py-2 rounded bg-white/20 text-white" />
              {/* Strength bar and feedback */}
              <div className="mt-2">
                <div className="w-full h-2 rounded bg-gray-700">
                  <div className={`h-2 rounded ${strengthColors[form.strength]}`} style={{ width: `${(zxcvbnResult.score + 1) * 20}%` }}></div>
                </div>
                <div className="text-xs text-white mt-1">
                  {zxcvbnResult.feedback.warning && <div className="text-yellow-300">{zxcvbnResult.feedback.warning}</div>}
                  {zxcvbnResult.feedback.suggestions && zxcvbnResult.feedback.suggestions.map((s, i) => (
                    <div key={i} className="text-blue-300">{s}</div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-white mb-1">Strength</label>
              <span className={`px-2 py-1 rounded text-xs ${strengthColors[form.strength]}`}>{form.strength}</span>
            </div>
            {error && <div className="text-red-500 text-sm mb-4">{error}</div>}
            <button type="submit" className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded">Save</button>
            <button type="button" className="ml-2 bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded" onClick={() => setShowAdd(false)}>Cancel</button>
          </form>
        )}
        <div className="bg-white/10 rounded-xl p-6">
          <table className="w-full text-white">
            <thead>
              <tr>
                <th className="text-left">Site</th>
                <th className="text-left">Username</th>
                <th className="text-left">Password</th>
                <th className="text-left">Strength</th>
              </tr>
            </thead>
            <tbody>
              {credentials.map((cred) => (
                <tr key={cred.id} className="border-b border-white/20">
                  <td>{cred.site}</td>
                  <td>{cred.username}</td>
                  <td>{cred.password}</td>
                  <td>
                    <span className={`px-2 py-1 rounded text-xs ${cred.strength === "strong" ? "bg-green-600" : cred.strength === "medium" ? "bg-yellow-600" : "bg-red-600"}`}>{cred.strength}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default VaultPage;
