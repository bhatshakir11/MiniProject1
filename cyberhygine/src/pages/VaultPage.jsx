import React, { useState, useEffect } from "react";
import Navbar from "../components/Navbar";
import AnimatedBackground from "../components/AnimatedBackground";
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
  const [removingId, setRemovingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ site: "", username: "", password: "", strength: "medium" });
  const [editZxcvbnResult, setEditZxcvbnResult] = useState(zxcvbn(""));

  useEffect(() => {
    // Fetch credentials from backend
    axios.get(`${API_BASE_URL}/credentials`).then(res => {
      setCredentials(res.data);
    });
  }, []);

  const handleRemove = async (id) => {
    setRemovingId(id);
    setError("");
    try {
      await axios.delete(`${API_BASE_URL}/credentials/${id}`);
      // Refresh credentials list
      const res = await axios.get(`${API_BASE_URL}/credentials`);
      setCredentials(res.data);
    } catch (err) {
      setError("Failed to remove credential.");
    }
    setRemovingId(null);
  };

    const handleEditClick = (cred) => {
      setEditingId(cred.id);
      setEditForm({
        site: cred.site,
        username: cred.username,
        password: cred.password,
        strength: cred.strength
      });
      setEditZxcvbnResult(zxcvbn(cred.password));
      setError("");
    };

    const handleEditChange = (e) => {
      const { name, value } = e.target;
      let updatedForm = { ...editForm, [name]: value };
      if (name === "password") {
        const result = zxcvbn(value);
        updatedForm.strength = getPasswordStrength(value);
        setEditZxcvbnResult(result);
      }
      setEditForm(updatedForm);
    };

    const handleEditSave = async (id) => {
      setError("");
      try {
        await axios.put(`${API_BASE_URL}/credentials/${id}`, editForm);
        // Refresh credentials list
        const res = await axios.get(`${API_BASE_URL}/credentials`);
        setCredentials(res.data);
        setEditingId(null);
      } catch (err) {
        setError("Failed to update credential.");
      }
    };

    const handleEditCancel = () => {
      setEditingId(null);
      setError("");
    };
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
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900">
      <AnimatedBackground />
      <Navbar />
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 relative z-10">
        <h2 className="text-4xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent mb-8 animate-fade-in">Password Vault</h2>
        <button
          className="mb-6 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white px-6 py-3 rounded-lg btn-futuristic shadow-lg transition-all"
          onClick={() => setShowAdd(true)}
        >
          Add Credential
        </button>
        {showAdd && (
          <form onSubmit={handleAdd} className="glass-card rounded-2xl p-6 mb-6 animate-fade-in">
            <div className="mb-4">
              <label className="block text-cyan-300 font-semibold mb-2">Site</label>
              <input name="site" value={form.site} onChange={handleChange} required className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white focus:outline-none focus:border-cyan-400 transition-all" />
            </div>
            <div className="mb-4">
              <label className="block text-cyan-300 font-semibold mb-2">Username</label>
              <input name="username" value={form.username} onChange={handleChange} required className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white focus:outline-none focus:border-cyan-400 transition-all" />
            </div>
            <div className="mb-4">
              <label className="block text-cyan-300 font-semibold mb-2">Password</label>
              <input name="password" value={form.password} onChange={handleChange} required className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white focus:outline-none focus:border-cyan-400 transition-all" />
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
              <label className="block text-cyan-300 font-semibold mb-2">Strength</label>
              <span className={`px-2 py-1 rounded text-xs ${strengthColors[form.strength]}`}>{form.strength}</span>
            </div>
            {error && <div className="text-red-500 text-sm mb-4">{error}</div>}
            <button type="submit" className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white px-6 py-3 rounded-lg btn-futuristic shadow-lg transition-all">Save</button>
            <button type="button" className="ml-3 bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white px-6 py-3 rounded-lg btn-futuristic shadow-lg transition-all" onClick={() => setShowAdd(false)}>Cancel</button>
          </form>
        )}
        <div className="glass-card rounded-2xl p-6 animate-fade-in overflow-x-auto">
          <table className="w-full text-white min-w-[800px]">
            <thead>
              <tr>
                <th className="text-left text-cyan-300 font-semibold pb-4">Site</th>
                <th className="text-left text-cyan-300 font-semibold pb-4">Username</th>
                <th className="text-left text-cyan-300 font-semibold pb-4">Password</th>
                <th className="text-left text-cyan-300 font-semibold pb-4">Strength</th>
                <th className="text-left text-cyan-300 font-semibold pb-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {credentials.map((cred) => (
                <tr key={cred.id} className="border-b border-white/10 hover:bg-white/5 transition-colors">
                  {editingId === cred.id ? (
                    <>
                      <td>
                        <input
                          name="site"
                          value={editForm.site}
                          onChange={handleEditChange}
                          className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white focus:outline-none focus:border-cyan-400 transition-all"
                        />
                      </td>
                      <td>
                        <input
                          name="username"
                          value={editForm.username}
                          onChange={handleEditChange}
                          className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white focus:outline-none focus:border-cyan-400 transition-all"
                        />
                      </td>
                      <td>
                        <input
                          name="password"
                          value={editForm.password}
                          onChange={handleEditChange}
                          className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white focus:outline-none focus:border-cyan-400 transition-all"
                        />
                        <div className="mt-1">
                          <div className="w-full h-1 rounded bg-gray-700">
                            <div className={`h-1 rounded ${strengthColors[editForm.strength]}`} style={{ width: `${(editZxcvbnResult.score + 1) * 20}%` }}></div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`px-2 py-1 rounded text-xs ${strengthColors[editForm.strength]}`}>{editForm.strength}</span>
                      </td>
                      <td>
                        <button
                          className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white px-3 py-2 rounded-lg btn-futuristic shadow-md transition-all mr-2"
                          onClick={() => handleEditSave(cred.id)}
                        >
                          Save
                        </button>
                        <button
                          className="bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white px-3 py-2 rounded-lg btn-futuristic shadow-md transition-all"
                          onClick={handleEditCancel}
                        >
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{cred.site}</td>
                      <td>{cred.username}</td>
                      <td>{cred.password}</td>
                      <td>
                        <span className={`px-2 py-1 rounded text-xs ${cred.strength === "strong" ? "bg-green-600" : cred.strength === "medium" ? "bg-yellow-600" : "bg-red-600"}`}>{cred.strength}</span>
                      </td>
                      <td>
                        <button
                          className="bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white px-3 py-2 rounded-lg btn-futuristic shadow-md transition-all mr-2"
                          onClick={() => handleEditClick(cred)}
                        >
                          Edit
                        </button>
                        <button
                          className="bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-700 hover:to-pink-700 text-white px-3 py-2 rounded-lg btn-futuristic shadow-md transition-all"
                          onClick={() => handleRemove(cred.id)}
                          disabled={removingId === cred.id}
                        >
                          {removingId === cred.id ? "Removing..." : "Remove"}
                        </button>
                      </td>
                    </>
                  )}
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
