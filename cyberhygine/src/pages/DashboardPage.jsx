import React, { useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import axios from "axios";
import API_BASE_URL from "../config";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from "recharts";

const STRENGTH_COLORS = {
  Strong: "#00C49F",
  Medium: "#FFD600",
  Weak: "#FF8042",
};

const DashboardPage = () => {
  const [stats, setStats] = useState({ strong: 0, weak: 0, medium: 0, score: 0, reused: 0, unique: 0 });
  const [credentials, setCredentials] = useState([]);

  useEffect(() => {
    const fetchStats = () => {
      axios.get(`${API_BASE_URL}/dashboard`).then(res => {
        setStats(res.data);
      });
      axios.get(`${API_BASE_URL}/credentials`).then(res => {
        setCredentials(res.data);
      });
    };
    fetchStats();
    const interval = setInterval(fetchStats, 2000); // Poll every 2s for real-time updates
    return () => clearInterval(interval);
  }, []);

  const hygieneScore = stats.score;
  const passwordStats = [
    { name: "Strong", value: stats.strong },
    { name: "Medium", value: stats.medium },
    { name: "Weak", value: stats.weak },
  ];
  const reusedStats = [
    { name: "Reused", value: stats.reused },
    { name: "Unique", value: stats.unique },
  ];
  const COLORS = ["#00C49F", "#FF8042", "#FFD600"];

  // Generate real-time reminders and tips
  const reminders = [];
  const passwordMap = {};
  credentials.forEach(cred => {
    // Check for reused passwords
    if (passwordMap[cred.password]) {
      passwordMap[cred.password].push(cred.site);
    } else {
      passwordMap[cred.password] = [cred.site];
    }
    // Weak password alert
    if (cred.strength === "weak") {
      reminders.push(`Weak password detected for ${cred.site}`);
    }
  });
  Object.entries(passwordMap).forEach(([pwd, sites]) => {
    if (sites.length > 1) {
      reminders.push(`Password reused for: ${sites.join(", ")}`);
    }
  });
  if (reminders.length === 0) {
    reminders.push("All your passwords are strong and unique! Great job!");
  }

  // Real-time tips
  const tips = [];
  if (stats.weak > 0) tips.push("Consider updating weak passwords to stronger ones.");
  if (stats.reused > 0) tips.push("Avoid reusing passwords across sites.");
  if (stats.strong === 0) tips.push("Try to use strong passwords for all accounts.");
  if (tips.length === 0) tips.push("Your vault is in excellent shape!");

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-blue-900">
      <Navbar />
      <div className="max-w-5xl mx-auto py-8 px-4">
        <h2 className="text-3xl font-bold text-white mb-6">Dashboard</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-white/10 rounded-xl p-6 shadow text-center">
            <h3 className="text-lg text-white mb-2">Cyber Hygiene Score</h3>
            <div className="flex flex-col items-center">
              <PieChart width={180} height={180}>
                <Pie
                  data={[{ name: "Score", value: hygieneScore }, { name: "Rest", value: 100 - hygieneScore }]}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  startAngle={90}
                  endAngle={-270}
                  dataKey="value"
                >
                  <Cell key="score" fill="#00C49F" />
                  <Cell key="rest" fill="#22223b" />
                </Pie>
              </PieChart>
              <span className="text-3xl font-bold text-white mt-2">{hygieneScore}%</span>
            </div>
          </div>
          <div className="bg-white/10 rounded-xl p-6 shadow">
            <h3 className="text-lg text-white mb-2">Password Strength</h3>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={passwordStats}>
                <XAxis dataKey="name" stroke="#fff" />
                <YAxis stroke="#fff" />
                <Tooltip />
                <Legend />
                <Bar dataKey="value">
                  {passwordStats.map((entry, idx) => (
                    <Cell key={`cell-bar-${idx}`} fill={STRENGTH_COLORS[entry.name]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
          <div className="bg-white/10 rounded-xl p-6 shadow">
            <h3 className="text-lg text-white mb-2">Reused vs Unique Passwords</h3>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={reusedStats}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={70}
                  label
                >
                  {reusedStats.map((entry, idx) => (
                    <Cell key={`cell-${idx}`} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white/10 rounded-xl p-6 shadow flex flex-col justify-center items-center">
            <h3 className="text-lg text-white mb-2">Reminders & Alerts</h3>
            <ul className="text-white mb-2">
              {reminders.map((rem, idx) => (
                <li key={idx}>{rem}</li>
              ))}
            </ul>
            <h4 className="text-md text-blue-300 mb-1">Tips:</h4>
            <ul className="text-blue-200">
              {tips.map((tip, idx) => (
                <li key={idx}>{tip}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
