import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "./lib/supabase";

function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [transactions, setTransactions] = useState([]);

  const [amount, setAmount] = useState("");
  const [receiver, setReceiver] = useState("");
  const [category, setCategory] = useState("Shopping");
  const [receipt, setReceipt] = useState(null);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // --------------------------------------------------
  // CHECK CURRENT SESSION
  // --------------------------------------------------
  useEffect(() => {
    const getSession = async () => {
      const { data, error } = await supabase.auth.getSession();

      if (error) {
        setError(error.message);
      }

      setSession(data.session);
      setLoading(false);
    };

    getSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // --------------------------------------------------
  // LOAD USER TRANSACTIONS
  // --------------------------------------------------
  const loadTransactions = useCallback(async () => {
    if (!session?.user?.id) {
      setTransactions([]);
      return;
    }

    const { data, error } = await supabase
      .from("transactions")
      .select("*")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      setError(error.message);
      return;
    }

    setTransactions(data || []);
  }, [session?.user?.id]);

  // Load transactions when user changes
  useEffect(() => {
    if (session?.user?.id) {
      loadTransactions();
    }
  }, [session?.user?.id, loadTransactions]);

  // --------------------------------------------------
  // REALTIME TRANSACTION UPDATES
  // --------------------------------------------------
  useEffect(() => {
    if (!session?.user?.id) {
      return;
    }

    const channel = supabase
      .channel(`smartpay-transactions-${session.user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "transactions",
          filter: `user_id=eq.${session.user.id}`,
        },
        () => {
          loadTransactions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, loadTransactions]);

  // --------------------------------------------------
  // LOGIN / REGISTER
  // --------------------------------------------------
  const handleAuth = async (e) => {
    e.preventDefault();

    setMessage("");
    setError("");

    if (!email || !password) {
      setError("Please enter email and password.");
      return;
    }

    setBusy(true);

    try {
      if (authMode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          throw error;
        }

        setMessage("Login successful.");
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) {
          throw error;
        }

        if (!data.session) {
          setMessage(
            "Registration successful. If email confirmation is enabled, confirm your email and then login."
          );
        } else {
          setMessage("Registration successful.");
        }
      }
    } catch (err) {
      setError(err.message || "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  // --------------------------------------------------
  // LOGOUT
  // --------------------------------------------------
  const handleLogout = async () => {
    setMessage("");
    setError("");

    const { error } = await supabase.auth.signOut();

    if (error) {
      setError(error.message);
      return;
    }

    setTransactions([]);
  };

  // --------------------------------------------------
  // RISK CALCULATION
  // --------------------------------------------------
  const calculateRisk = (transactionAmount) => {
    const value = Number(transactionAmount);

    if (value >= 20000) {
      return {
        riskLevel: "HIGH",
        riskScore: 90,
        status: "Blocked",
      };
    }

    if (value >= 5000) {
      return {
        riskLevel: "MEDIUM",
        riskScore: 55,
        status: "Verify",
      };
    }

    return {
      riskLevel: "LOW",
      riskScore: 10,
      status: "Approved",
    };
  };

  // --------------------------------------------------
  // ADD TRANSACTION
  // --------------------------------------------------
  const handleAddTransaction = async (e) => {
    e.preventDefault();

    setMessage("");
    setError("");

    if (!session?.user?.id) {
      setError("Please login first.");
      return;
    }

    if (!amount || Number(amount) <= 0) {
      setError("Please enter a valid amount.");
      return;
    }

    if (!receiver.trim()) {
      setError("Please enter receiver name.");
      return;
    }

    setBusy(true);

    let receiptPath = null;

    try {
      const risk = calculateRisk(amount);

      // ----------------------------------------------
      // RECEIPT UPLOAD
      // ----------------------------------------------
      if (receipt) {
        const fileExtension =
          receipt.name.includes(".")
            ? receipt.name.split(".").pop()
            : "file";

        const fileName = `${Date.now()}-${Math.random()
          .toString(36)
          .substring(2)}.${fileExtension}`;

        const filePath = `${session.user.id}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from("payment-receipts")
          .upload(filePath, receipt, {
            upsert: false,
          });

        if (uploadError) {
          throw new Error(
            `Receipt upload failed: ${uploadError.message}`
          );
        }

        receiptPath = filePath;
      }

      // ----------------------------------------------
      // INSERT TRANSACTION
      // ----------------------------------------------
      const { error: insertError } = await supabase
        .from("transactions")
        .insert([
          {
            user_id: session.user.id,
            amount: Number(amount),
            receiver: receiver.trim(),
            category,
            risk_level: risk.riskLevel,
            risk_score: risk.riskScore,
            status: risk.status,
            receipt_path: receiptPath,
          },
        ]);

      if (insertError) {
        throw new Error(
          `Transaction failed: ${insertError.message}`
        );
      }

      setMessage(
        `Transaction added successfully. Risk: ${risk.riskLevel}`
      );

      // Clear form
      setAmount("");
      setReceiver("");
      setCategory("Shopping");
      setReceipt(null);

      const fileInput = document.getElementById("receipt-input");

      if (fileInput) {
        fileInput.value = "";
      }

      await loadTransactions();
    } catch (err) {
      setError(err.message || "Transaction failed.");
    } finally {
      setBusy(false);
    }
  };

  // --------------------------------------------------
  // REFRESH
  // --------------------------------------------------
  const handleRefresh = async () => {
    setMessage("");
    setError("");
    await loadTransactions();
  };

  // --------------------------------------------------
  // LOADING
  // --------------------------------------------------
  if (loading) {
    return (
      <div style={styles.centerPage}>
        <div style={styles.loadingCard}>
          <h2>SmartPay</h2>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  // --------------------------------------------------
  // LOGIN / REGISTER SCREEN
  // --------------------------------------------------
  if (!session) {
    return (
      <div style={styles.centerPage}>
        <div style={styles.authCard}>
          <h1 style={styles.logo}>SmartPay</h1>

          <p style={styles.subtitle}>
            Safe Digital Payment Assistance
          </p>

          <div style={styles.authTabs}>
            <button
              type="button"
              onClick={() => {
                setAuthMode("login");
                setMessage("");
                setError("");
              }}
              style={{
                ...styles.tabButton,
                ...(authMode === "login"
                  ? styles.activeTab
                  : {}),
              }}
            >
              Login
            </button>

            <button
              type="button"
              onClick={() => {
                setAuthMode("register");
                setMessage("");
                setError("");
              }}
              style={{
                ...styles.tabButton,
                ...(authMode === "register"
                  ? styles.activeTab
                  : {}),
              }}
            >
              Register
            </button>
          </div>

          <form onSubmit={handleAuth}>
            <label style={styles.label}>Email</label>

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter email"
              style={styles.input}
            />

            <label style={styles.label}>Password</label>

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              style={styles.input}
            />

            <button
              type="submit"
              disabled={busy}
              style={styles.primaryButton}
            >
              {busy
                ? "Please wait..."
                : authMode === "login"
                ? "Login"
                : "Create Account"}
            </button>
          </form>

          {message && (
            <div style={styles.successMessage}>{message}</div>
          )}

          {error && (
            <div style={styles.errorMessage}>{error}</div>
          )}

          <div style={styles.footer}>
            Powered by React + Supabase
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------
  // DASHBOARD
  // --------------------------------------------------
  return (
    <div style={styles.page}>
      <div style={styles.container}>
        {/* HEADER */}
        <div style={styles.header}>
          <div>
            <h1 style={styles.logo}>SmartPay</h1>
            <p style={styles.subtitle}>
              Safe Digital Payment Assistance
            </p>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            style={styles.logoutButton}
          >
            Logout
          </button>
        </div>

        {/* USER */}
        <div style={styles.userBar}>
          Logged in as:{" "}
          <strong>{session.user.email}</strong>
        </div>

        {/* DASHBOARD CARDS */}
        <div style={styles.cardGrid}>
          <div style={styles.dashboardCard}>
            <div style={styles.icon}>💳</div>
            <h3>Transactions</h3>
            <div style={styles.bigNumber}>
              {transactions.length}
            </div>
            <p>Total Transactions</p>
          </div>

          <div style={styles.dashboardCard}>
            <div style={styles.icon}>🛡️</div>
            <h3>Security</h3>
            <div style={styles.bigText}>Active</div>
            <p>Risk Protection</p>
          </div>

          <div style={styles.dashboardCard}>
            <div style={styles.icon}>🔐</div>
            <h3>Backend</h3>
            <div style={styles.bigText}>Supabase</div>
            <p>Connected</p>
          </div>

          <div style={styles.dashboardCard}>
            <div style={styles.icon}>⚡</div>
            <h3>Realtime</h3>
            <div style={styles.bigText}>Active</div>
            <p>Live Updates</p>
          </div>
        </div>

        {/* ADD TRANSACTION */}
        <div style={styles.section}>
          <h2>Add New Transaction</h2>

          <form onSubmit={handleAddTransaction}>
            <input
              type="number"
              min="1"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount"
              style={styles.input}
            />

            <input
              type="text"
              value={receiver}
              onChange={(e) => setReceiver(e.target.value)}
              placeholder="Receiver"
              style={styles.input}
            />

            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={styles.input}
            >
              <option value="Shopping">Shopping</option>
              <option value="Groceries">Groceries</option>
              <option value="Food">Food</option>
              <option value="Bills">Bills</option>
              <option value="Travel">Travel</option>
              <option value="Transfer">Transfer</option>
              <option value="Other">Other</option>
            </select>

            <label style={styles.receiptLabel}>
              Payment Receipt
            </label>

            <input
              id="receipt-input"
              type="file"
              accept="image/*,.pdf"
              onChange={(e) =>
                setReceipt(e.target.files?.[0] || null)
              }
              style={styles.fileInput}
            />

            <button
              type="submit"
              disabled={busy}
              style={styles.primaryButton}
            >
              {busy
                ? "Processing..."
                : "Check Risk & Add Transaction"}
            </button>
          </form>

          {message && (
            <div style={styles.successMessage}>{message}</div>
          )}

          {error && (
            <div style={styles.errorMessage}>{error}</div>
          )}
        </div>

        {/* TRANSACTION HISTORY */}
        <div style={styles.section}>
          <div style={styles.historyHeader}>
            <h2>Transaction History</h2>

            <button
              type="button"
              onClick={handleRefresh}
              style={styles.refreshButton}
            >
              🔄 Refresh
            </button>
          </div>

          {transactions.length === 0 ? (
            <p style={styles.emptyText}>
              No transactions found.
            </p>
          ) : (
            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Amount</th>
                    <th style={styles.th}>Receiver</th>
                    <th style={styles.th}>Category</th>
                    <th style={styles.th}>Risk</th>
                    <th style={styles.th}>Score</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Receipt</th>
                  </tr>
                </thead>

                <tbody>
                  {transactions.map((transaction) => (
                    <tr key={transaction.id}>
                      <td style={styles.td}>
                        ₹{transaction.amount}
                      </td>

                      <td style={styles.td}>
                        {transaction.receiver}
                      </td>

                      <td style={styles.td}>
                        {transaction.category}
                      </td>

                      <td style={styles.td}>
                        <span
                          style={{
                            ...styles.riskBadge,
                            ...(transaction.risk_level ===
                            "HIGH"
                              ? styles.highRisk
                              : transaction.risk_level ===
                                "MEDIUM"
                              ? styles.mediumRisk
                              : styles.lowRisk),
                          }}
                        >
                          {transaction.risk_level}
                        </span>
                      </td>

                      <td style={styles.td}>
                        {transaction.risk_score}
                      </td>

                      <td style={styles.td}>
                        <strong>{transaction.status}</strong>
                      </td>

                      <td style={styles.td}>
                        {transaction.receipt_path ? (
                          <span style={styles.uploaded}>
                            Uploaded ✓
                          </span>
                        ) : (
                          "None"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div style={styles.footer}>
          <p>
            SmartPay — Safe Digital Payment Assistance
          </p>
          <p>Powered by React + Supabase</p>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------
// STYLES
// --------------------------------------------------

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f4f7fb",
    fontFamily:
      "Arial, Helvetica, sans-serif",
    padding: "30px 15px",
    boxSizing: "border-box",
  },

  centerPage: {
    minHeight: "100vh",
    background: "#f4f7fb",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
    fontFamily:
      "Arial, Helvetica, sans-serif",
    boxSizing: "border-box",
  },

  container: {
    maxWidth: "1240px",
    margin: "0 auto",
  },

  authCard: {
    width: "100%",
    maxWidth: "450px",
    background: "#ffffff",
    borderRadius: "18px",
    padding: "35px",
    boxSizing: "border-box",
    boxShadow:
      "0 8px 30px rgba(0,0,0,0.08)",
  },

  loadingCard: {
    background: "#ffffff",
    padding: "40px",
    borderRadius: "18px",
    textAlign: "center",
    boxShadow:
      "0 8px 30px rgba(0,0,0,0.08)",
  },

  header: {
    background: "#ffffff",
    borderRadius: "18px",
    padding: "28px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    boxShadow:
      "0 5px 20px rgba(0,0,0,0.06)",
    marginBottom: "20px",
  },

  logo: {
    margin: 0,
    color: "#2563eb",
    fontSize: "34px",
    fontWeight: "700",
  },

  subtitle: {
    margin: "4px 0 0",
    color: "#666",
    fontSize: "18px",
  },

  userBar: {
    background: "#eef5ff",
    color: "#2454a6",
    padding: "14px 18px",
    borderRadius: "10px",
    marginBottom: "20px",
  },

  logoutButton: {
    background: "#dc2626",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    padding: "12px 24px",
    fontSize: "15px",
    fontWeight: "600",
    cursor: "pointer",
  },

  authTabs: {
    display: "flex",
    gap: "8px",
    marginBottom: "25px",
  },

  tabButton: {
    flex: 1,
    padding: "12px",
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    background: "#fff",
    cursor: "pointer",
    fontWeight: "600",
  },

  activeTab: {
    background: "#2563eb",
    color: "#fff",
    borderColor: "#2563eb",
  },

  label: {
    display: "block",
    marginBottom: "7px",
    fontWeight: "600",
  },

  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "14px",
    marginBottom: "16px",
    border: "1px solid #d5d9e0",
    borderRadius: "9px",
    fontSize: "16px",
    background: "#fff",
  },

  receiptLabel: {
    display: "block",
    fontWeight: "600",
    marginBottom: "8px",
  },

  fileInput: {
    display: "block",
    marginBottom: "18px",
    fontSize: "15px",
  },

  primaryButton: {
    width: "100%",
    border: "none",
    borderRadius: "8px",
    background: "#2563eb",
    color: "#fff",
    padding: "14px",
    fontSize: "17px",
    fontWeight: "600",
    cursor: "pointer",
  },

  successMessage: {
    marginTop: "15px",
    padding: "13px",
    borderRadius: "8px",
    background: "#edf6ff",
    color: "#2454a6",
  },

  errorMessage: {
    marginTop: "15px",
    padding: "13px",
    borderRadius: "8px",
    background: "#fff1f2",
    color: "#b42318",
  },

  cardGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "20px",
    marginBottom: "25px",
  },

  dashboardCard: {
    background: "#fff",
    borderRadius: "18px",
    padding: "28px",
    boxShadow:
      "0 5px 20px rgba(0,0,0,0.06)",
  },

  icon: {
    fontSize: "28px",
    marginBottom: "15px",
  },

  bigNumber: {
    fontSize: "28px",
    fontWeight: "700",
    margin: "15px 0",
  },

  bigText: {
    fontSize: "25px",
    fontWeight: "700",
    margin: "15px 0",
  },

  section: {
    background: "#fff",
    borderRadius: "18px",
    padding: "28px",
    marginBottom: "25px",
    boxShadow:
      "0 5px 20px rgba(0,0,0,0.06)",
  },

  historyHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "15px",
    marginBottom: "15px",
  },

  refreshButton: {
    background: "#fff",
    color: "#2563eb",
    border: "1px solid #b7c9f8",
    borderRadius: "8px",
    padding: "10px 16px",
    cursor: "pointer",
  },

  tableWrapper: {
    overflowX: "auto",
  },

  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: "850px",
  },

  th: {
    textAlign: "left",
    padding: "14px 10px",
    borderBottom: "2px solid #e5e7eb",
    fontSize: "15px",
  },

  td: {
    padding: "14px 10px",
    borderBottom: "1px solid #e5e7eb",
    fontSize: "15px",
  },

  riskBadge: {
    display: "inline-block",
    padding: "5px 10px",
    borderRadius: "20px",
    fontSize: "12px",
    fontWeight: "700",
  },

  lowRisk: {
    background: "#dcfce7",
    color: "#166534",
  },

  mediumRisk: {
    background: "#fef3c7",
    color: "#92400e",
  },

  highRisk: {
    background: "#fee2e2",
    color: "#b91c1c",
  },

  uploaded: {
    color: "#16803c",
    fontWeight: "600",
  },

  emptyText: {
    color: "#666",
    padding: "20px 0",
  },

  footer: {
    textAlign: "center",
    color: "#777",
    padding: "20px",
    lineHeight: "1.8",
  },
};

export default App;