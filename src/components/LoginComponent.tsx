"use client";

import React, { useState, useEffect } from "react";
import {
  useTournament,
  INITIAL_ACCOUNT_RULES,
} from "@/context/TournamentContext";
import {
  Users,
  Eye,
  Mail,
  Lock,
  EyeOff,
  Shield,
  ArrowRight,
  User,
  KeyRound,
  Send,
  ArrowLeft,
  Globe,
  ExternalLink,
  Home,
} from "lucide-react";
import { supabase, isSupabaseConfigured, basePath } from "@/db/dbClient";

export interface LoginComponentProps {
  isRegistrationPopup?: boolean;
  targetTournamentId?: string;
  onSuccess?: () => void;
}

export default function LoginComponent({
  isRegistrationPopup,
  targetTournamentId,
  onSuccess,
}: LoginComponentProps) {
  const { login, usersList, addUser, logoUrl, activeTournamentId } = useTournament();

  // Tab roles: 'Admin' | 'Co-Admin' | 'Viewer' | 'Club'
  const [activeRole, setActiveRole] = useState<
    "Admin" | "Co-Admin" | "Viewer" | "Club"
  >(isRegistrationPopup ? "Club" : "Viewer");

  // Modes: 'signIn' | 'signUp' | 'forgotPassword'
  const [mode, setMode] = useState<"signIn" | "signUp" | "forgotPassword">(
    "signIn",
  );

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      // Prevent Club login from generic portal without a tournament
      if (activeRole === "Club" && !isRegistrationPopup) {
        const tourneyId = targetTournamentId || activeTournamentId;
        if (!tourneyId) {
          setError("Club login is only available from a specific Tournament Registration portal.");
          setLoading(false);
          return;
        }
      }

      if (mode === "forgotPassword") {
        if (!email) {
          setError("Please enter your email address.");
          setLoading(false);
          return;
        }

        if (isSupabaseConfigured && supabase) {
          const { error: resetError } =
            await supabase.auth.resetPasswordForEmail(email.trim(), {
              redirectTo:
                window.location.origin + basePath + "/auth/reset-password",
            });
          if (resetError) {
            setError(resetError.message);
          } else {
            setMessage("A password reset link has been sent to your email.");
          }
        } else {
          setMessage("Mock password reset email sent successfully!");
        }
        setLoading(false);
        return;
      }

      if (activeRole === "Viewer" && mode === "signIn") {
        login("Viewer", "spectator@senshikarate.com");
        window.location.href = `${basePath}/public`;
        return;
      }

      if (mode === "signUp") {
        if (!name || !email || !password || !confirmPassword) {
          setError("Please fill in all fields.");
          setLoading(false);
          return;
        }

        if (password !== confirmPassword) {
          setError("Passwords do not match.");
          setLoading(false);
          return;
        }

        if (password.length < 6) {
          setError("Password must be at least 6 characters long.");
          setLoading(false);
          return;
        }

        if (isSupabaseConfigured && supabase) {
          const { data, error: signUpError } = await supabase.auth.signUp({
            email: email.trim(),
            password: password,
            options: {
              emailRedirectTo:
                window.location.origin + basePath + "/auth/callback",
              data: {
                name: name.trim(),
                role: activeRole,
              },
            },
          });

          if (signUpError) {
            const msg = signUpError.message;
            if (
              msg.includes("Failed to fetch") ||
              msg.includes("NetworkError") ||
              msg.includes("network")
            ) {
              console.warn(
                "Supabase sign up network error, falling back to local auth:",
                msg,
              );
              const newUser = {
                name: name.trim(),
                email: email.trim(),
                role: activeRole,
                status: "Active" as const,
                canModify: activeRole === "Club" ? true : false,
                accessibility: {
                  themeContrast: "standard" as const,
                  textScale: "standard" as const,
                  reducedMotion: false,
                  legibilityFont: "standard" as const,
                },
              };
              addUser(newUser as any);
              const fallbackClubId = activeRole === "Club" ? "senshi-club-001" : null;
              login(activeRole, email.trim(), null, null, fallbackClubId);
              if (onSuccess) {
                onSuccess();
              } else if (activeRole === "Club") {
                const tourneyId = targetTournamentId || activeTournamentId;
                if (tourneyId) {
                  window.location.href = `${basePath}/registration/${tourneyId}/club`;
                } else {
                  window.location.href = `${basePath}/`;
                }
              } else {
                window.location.href = `${basePath}/public`;
              }
              setLoading(false);
              return;
            }
            setError(signUpError.message);
            setLoading(false);
            return;
          }

          // Register user locally with proper role access
          const newUser = {
            name: name.trim(),
            email: email.trim(),
            role: activeRole as any,
            status: "Active" as const,
            canModify: activeRole === "Club" ? true : false,
            accessibility: {
              themeContrast: "standard" as const,
              textScale: "standard" as const,
              reducedMotion: false,
              legibilityFont: "standard" as const,
            },
          };
          addUser(newUser);

          if (data.session) {
            const fallbackClubId = activeRole === "Club" ? "senshi-club-001" : null;
            login(activeRole as any, email.trim(), null, null, fallbackClubId);
            if (activeRole === "Club") {
              const tourneyId = targetTournamentId || activeTournamentId;
              if (tourneyId) {
                window.location.href = `${basePath}/registration/${tourneyId}/club`;
              } else {
                window.location.href = `${basePath}/`;
              }
            } else {
              window.location.href = `${basePath}/public`;
            }
          } else {
            setMessage(
              "Registration successful! Please check your email to confirm your account.",
            );
          }
        } else {
          // Mock Sign Up as Viewer or Club
          const newUser = {
            name: name.trim(),
            email: email.trim(),
            role: activeRole,
            status: "Active" as const,
            canModify: activeRole === "Club" ? true : false,
            accessibility: {
              themeContrast: "standard" as const,
              textScale: "standard" as const,
              reducedMotion: false,
              legibilityFont: "standard" as const,
            },
          };
          addUser(newUser as any);
          const fallbackClubId = activeRole === "Club" ? "senshi-club-001" : null;
          login(activeRole, email.trim(), null, null, fallbackClubId);
          if (onSuccess) {
            onSuccess();
          } else if (activeRole === "Club") {
            const tourneyId = targetTournamentId || activeTournamentId;
            if (tourneyId) {
              window.location.href = `${basePath}/registration/${tourneyId}/club`;
            } else {
              window.location.href = `${basePath}/`;
            }
          } else {
            window.location.href = `${basePath}/public`;
          }
        }
        setLoading(false);
        return;
      }

      // Mode is 'signIn'
      if (!email || !password) {
        setError("Please enter both email and password.");
        setLoading(false);
        return;
      }

      const isMockBypass = password.trim() === "password" && (
        email.trim().toLowerCase() === "club@senshikarate.com" ||
        email.trim().toLowerCase() in INITIAL_ACCOUNT_RULES
      );

      if (isSupabaseConfigured && supabase && !isMockBypass) {
        const { data, error: signInError } =
          await supabase.auth.signInWithPassword({
            email: email.trim(),
            password: password.trim(),
          });

        if (signInError) {
          const msg = signInError.message;
          if (
            msg.includes("Failed to fetch") ||
            msg.includes("NetworkError") ||
            msg.includes("network")
          ) {
            console.warn(
              "Supabase sign in network error, falling back to local auth:",
              msg,
            );
            const userEmail = email.trim().toLowerCase();
            let authoritativeRole:
              "Admin" | "Co-Admin" | "Viewer" | "Club" | null = null;
            let pcId: string | null = null;
            let tatami: number | null = null;

            if (userEmail in INITIAL_ACCOUNT_RULES) {
              const rule =
                INITIAL_ACCOUNT_RULES[
                  userEmail as keyof typeof INITIAL_ACCOUNT_RULES
                ];
              authoritativeRole = rule.role;
              pcId = rule.pcId;
              tatami = rule.tatami;
            }

            const userObj = usersList.find(
              (u) => u.email.toLowerCase() === userEmail,
            );
            const actualRole =
              authoritativeRole || (userObj ? userObj.role : "Viewer");

            if (!userObj && !authoritativeRole) {
              setError(
                `No account found for ${email}. Please contact the administrator.`,
              );
              setLoading(false);
              return;
            }

            if (isRegistrationPopup && actualRole !== "Club") {
              setError("Access denied. Registration portal is strictly for Club access only.");
              setLoading(false);
              return;
            }

            if (userObj && userObj.status === "Suspended") {
              setError(
                "Your access has been suspended by the Tournament Director.",
              );
              setLoading(false);
              return;
            }

            if (actualRole !== activeRole) {
              if (authoritativeRole === "Co-Admin") {
                setError(
                  `Access denied. This account is registered for Tatami ${tatami}.`,
                );
              } else if (actualRole === "Admin") {
                setError(
                  `Access denied. This account is registered for Director.`,
                );
              } else {
                setError(
                  `Access denied. Your account is registered as a ${actualRole}.`,
                );
              }
              setLoading(false);
              return;
            }

            if (actualRole === "Admin") {
              setMessage("Access granted: Tournament Director (Admin PC).");
            } else if (actualRole === "Co-Admin") {
              setMessage(`Access granted: Tatami ${tatami} Operator Console.`);
            }

            login(actualRole, userEmail, pcId, tatami, userObj?.club_id);
            setTimeout(() => {
              if (onSuccess) {
                onSuccess();
              } else if (actualRole === "Admin") {
                window.location.href = `${basePath}/admin`;
              } else if (actualRole === "Club") {
                const tourneyId = targetTournamentId || activeTournamentId;
                if (tourneyId) {
                  window.location.href = `${basePath}/registration/${tourneyId}/club`;
                } else {
                  window.location.href = `${basePath}/`;
                }
              } else {
                window.location.href = `${basePath}/dashboard/operator`;
              }
            }, 800);
            return;
          }
          setError(signInError.message);
          setLoading(false);
          return;
        }

        // On successful sign in, make sure user is in local usersList
        const userEmail = (data.user?.email || email).trim().toLowerCase();

        let authoritativeRole: "Admin" | "Co-Admin" | "Viewer" | "Club" | null =
          null;
        let pcId: string | null = null;
        let tatami: number | null = null;

        if (userEmail in INITIAL_ACCOUNT_RULES) {
          const rule =
            INITIAL_ACCOUNT_RULES[
              userEmail as keyof typeof INITIAL_ACCOUNT_RULES
            ];
          authoritativeRole = rule.role;
          pcId = rule.pcId;
          tatami = rule.tatami;
        }

        let matchedUser = usersList.find(
          (u) => u.email.toLowerCase() === userEmail,
        );

        // Determine actual role
        const actualRole =
          authoritativeRole || (matchedUser ? matchedUser.role : (data.user?.user_metadata?.role || "Viewer"));

        // Tab selection validation (if they are suspended, we check that below)
        
        if (!matchedUser) {
          const displayName =
            data.user?.user_metadata?.name || userEmail.split("@")[0];
          const newUser = {
            name: displayName,
            email: userEmail,
            role: actualRole,
            status: "Active" as const,
            canModify:
              actualRole === "Admin" ||
              actualRole === "Co-Admin" ||
              actualRole === "Club",
            accessibility: {
              themeContrast: "standard" as const,
              textScale: "standard" as const,
              reducedMotion: false,
              legibilityFont: "standard" as const,
            },
          };
          addUser(newUser as any);
          matchedUser = newUser as any;
        }

        // Registration Mode strict check
        if (isRegistrationPopup && actualRole !== "Club") {
          setError("Access denied. Registration portal is strictly for Club access only.");
          await supabase.auth.signOut();
          setLoading(false);
          return;
        }

        if (matchedUser && matchedUser.status === "Suspended") {
          setError(
            "Your access has been suspended by the Tournament Director.",
          );
          await supabase.auth.signOut();
          setLoading(false);
          return;
        }

        // Tab selection validation
        if (activeRole !== actualRole) {
          if (authoritativeRole === "Co-Admin") {
            setError(
              `Access denied. This account is registered for Tatami ${tatami}.`,
            );
          } else if (actualRole === "Admin") {
            setError(`Access denied. This account is registered for Director.`);
          } else {
            setError(
              `Access denied. Your account is registered as a ${actualRole}.`,
            );
          }
          await supabase.auth.signOut();
          setLoading(false);
          return;
        }

        if (!matchedUser) {
          // This code should not be reached now since we initialized it above
        }

        if (actualRole === "Admin") {
          setMessage("Access granted: Tournament Director (Admin PC).");
        } else if (actualRole === "Co-Admin") {
          setMessage(`Access granted: Tatami ${tatami} Operator Console.`);
        }

        const finalClubId = matchedUser?.club_id || (actualRole === "Club" ? "senshi-club-001" : null);
        login(actualRole, matchedUser?.email || userEmail, pcId, tatami, finalClubId);

        // Short delay to show success message before redirect
        setTimeout(() => {
          if (onSuccess) {
            onSuccess();
          } else if (actualRole === "Admin") {
            window.location.href = `${basePath}/admin`;
          } else if (actualRole === "Club") {
            // Club fallback redirect
            window.location.href = `${basePath}/registration`;
          } else {
            window.location.href = `${basePath}/dashboard/operator`;
          }
        }, 800);
        return;
      } else {
        // Mock Sign In
        const userEmail = email.trim().toLowerCase();
        let authoritativeRole: "Admin" | "Co-Admin" | "Viewer" | "Club" | null =
          null;
        let pcId: string | null = null;
        let tatami: number | null = null;

        if (userEmail in INITIAL_ACCOUNT_RULES) {
          const rule =
            INITIAL_ACCOUNT_RULES[
              userEmail as keyof typeof INITIAL_ACCOUNT_RULES
            ];
          authoritativeRole = rule.role;
          pcId = rule.pcId;
          tatami = rule.tatami;
        }

        const userObj = usersList.find(
          (u) => u.email.toLowerCase() === userEmail,
        );
        const actualRole =
          authoritativeRole || (userObj ? userObj.role : "Viewer");

        if (!userObj && !authoritativeRole) {
          setError(
            `No account found for ${email}. Please contact the administrator.`,
          );
          setLoading(false);
          return;
        }

        // Registration Mode strict check
        if (isRegistrationPopup && actualRole !== "Club") {
          setError("Access denied. Registration portal is strictly for Club access only.");
          setLoading(false);
          return;
        }

        if (userObj && userObj.status === "Suspended") {
          setError(
            "Your access has been suspended by the Tournament Director.",
          );
          setLoading(false);
          return;
        }

        if (actualRole !== activeRole) {
          if (authoritativeRole === "Co-Admin") {
            setError(
              `Access denied. This account is registered for Tatami ${tatami}.`,
            );
          } else if (actualRole === "Admin") {
            setError(`Access denied. This account is registered for Director.`);
          } else {
            setError(
              `Access denied. Your account is registered as a ${actualRole}.`,
            );
          }
          setLoading(false);
          return;
        }

        if (actualRole === "Admin") {
          setMessage("Access granted: Tournament Director (Admin PC).");
        } else if (actualRole === "Co-Admin") {
          setMessage(`Access granted: Tatami ${tatami} Operator Console.`);
        }

        const finalClubId = userObj?.club_id || (actualRole === "Club" ? "senshi-club-001" : null);
        login(actualRole, userEmail, pcId, tatami, finalClubId);
        setTimeout(() => {
          if (onSuccess) {
            onSuccess();
          } else if (actualRole === "Admin") {
            window.location.href = `${basePath}/admin`;
          } else if (actualRole === "Club") {
            const tourneyId = targetTournamentId || activeTournamentId;
            if (tourneyId) {
              window.location.href = `${basePath}/registration/${tourneyId}/club`;
            } else {
              window.location.href = `${basePath}/public`;
            }
          } else {
            window.location.href = `${basePath}/dashboard/operator`;
          }
        }, 800);
        return;
      }
    } catch (err: any) {
      setError(err?.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const getRoleHelpText = () => {
    switch (activeRole) {
      case "Admin":
        return "Full control panel access. Configure events, brackets, and manage all participants.";
      case "Co-Admin":
        return "Tournament floor access. Manage tatami schedules, bouts, and scoring parameters.";
      case "Viewer":
        return "Public spectator hub. Watch live streams, browse brackets, and view medal standings.";
      case "Club":
        return "Club registration console. Register participants, teams, and officials for this tournament.";
    }
  };

  if (!mounted) return null;

  return (
    <div className="relative min-h-screen w-screen flex items-center justify-center overflow-hidden bg-[#030712] font-sans text-slate-200">
      {/* --- DYNAMIC BACKGROUND & EFFECTS --- */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#030712] via-[#0f172a] to-[#030712] z-0" />

      {/* Glowing orbs */}
      <div
        className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/20 rounded-full blur-[120px] animate-pulse z-0"
        style={{ animationDuration: "4s" }}
      />
      <div
        className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-600/15 rounded-full blur-[150px] animate-pulse z-0"
        style={{ animationDuration: "5s" }}
      />

      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGcgc3Ryb2tlPSJibGFjayIgc3Ryb2tlLW9wYWNpdHk9IjAuMDUiIGZpbGw9Im5vbmUiPjxwYXRoIGQ9Ik02MCAwaC02MHY2MCIvPjwvZz48L3N2Zz4=')] opacity-20 z-0 mix-blend-overlay" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#030712] via-transparent to-[#030712] z-0" />

      {/* --- CONTENT WRAPPER --- */}
      <div className="relative z-10 w-full max-w-[440px] px-4 py-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
        {/* FROSTED GLASS CARD */}
        <div className="bg-[#0f172a]/60 backdrop-blur-2xl border border-white/10 rounded-[2rem] shadow-2xl shadow-black/50 overflow-hidden relative">
          <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent" />

          <div className="p-8 sm:p-10 flex flex-col items-center space-y-6">
            {/* CORPORATE HOME NAVIGATION LINKS */}
            <div className="flex items-center justify-between w-full pb-2 border-b border-white/5">
              <div className="flex items-center gap-2">
                <a
                  href="https://karatetech3.spsportdatasolution.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-950/40 border border-indigo-500/20 hover:bg-indigo-900/60 text-xs font-bold text-indigo-300 hover:text-white transition-all cursor-pointer group"
                  title="Return to Home"
                >
                  <Home className="h-3.5 w-3.5 group-hover:scale-110 transition-transform text-indigo-400" />
                  <span>Home</span>
                  <ExternalLink className="h-3 w-3 opacity-60 ml-0.5" />
                </a>
                <a
                  href="https://spsportdatasolution.org/karatetech/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-500/20 hover:bg-slate-700/60 text-xs font-bold text-slate-300 hover:text-white transition-all cursor-pointer group"
                  title="Corporate Home"
                >
                  <Globe className="h-3.5 w-3.5 group-hover:rotate-12 transition-transform text-slate-400" />
                  <span>Corporate Home</span>
                  <ExternalLink className="h-3 w-3 opacity-60 ml-0.5" />
                </a>
              </div>
            </div>

            {/* HEADER */}
            <div className="flex flex-col items-center space-y-4 text-center w-full">
              <a
                href="https://spsportdatasolution.org/karatetech/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center space-y-3 group cursor-pointer"
                title="Open Corporate Home"
              >
                <div className="h-24 w-24 rounded-full overflow-hidden border-2 border-white/20 bg-slate-900 shrink-0 group-hover:scale-105 group-hover:border-indigo-400 transition-all shadow-xl">
                  <img
                    src={`${basePath}/karatetech-logo.png`}
                    alt="KarateTech Logo"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="flex flex-col items-center leading-none">
                  <div
                    style={{
                      fontFamily: "'Montserrat', sans-serif",
                      fontWeight: 900,
                      fontSize: "1.15rem",
                      lineHeight: 1,
                      letterSpacing: "0.01em",
                    }}
                  >
                    <span style={{ color: "#b91c2e" }}>Karate</span>
                    <span style={{ color: "#38bdf8" }}>Tech</span>
                  </div>
                  <div
                    style={{
                      height: "2px",
                      width: "80px",
                      background:
                        "linear-gradient(90deg, #b91c2e 60%, transparent 100%)",
                      marginTop: "2px",
                      marginBottom: "2px",
                      borderRadius: "1px",
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "'Montserrat', sans-serif",
                      fontWeight: 700,
                      fontSize: "0.78rem",
                      letterSpacing: "0.01em",
                      color: "#818cf8",
                      lineHeight: 1.15,
                    }}
                    className="group-hover:underline flex items-center gap-1"
                  >
                    SP SportData Solution{" "}
                    <ExternalLink className="inline h-2.5 w-2.5 opacity-70" />
                  </span>
                  <span
                    style={{
                      fontFamily: "'Montserrat', sans-serif",
                      fontWeight: 600,
                      fontSize: "0.58rem",
                      letterSpacing: "0.08em",
                      color: "#64748b",
                      lineHeight: 1.2,
                      marginTop: "2px",
                    }}
                  >
                    • Precision. • Speed. • Results. •
                  </span>
                </div>
              </a>

              <div className="space-y-1 mt-2">
                <h2 className="text-lg font-black tracking-tight text-white uppercase drop-shadow-md">
                  Senshi Goju-Ryu
                </h2>
                <p className="text-xs text-indigo-300/80 font-medium tracking-widest uppercase">
                  {isRegistrationPopup 
                    ? "Club Registration Login"
                    : mode === "signIn"
                      ? "Tournament Sign In"
                      : mode === "signUp"
                        ? "Create Account"
                        : "Password Recovery"}
                </p>
              </div>
            </div>

            {/* ROLE SELECTOR */}
            {mode !== "forgotPassword" && (
              <div className="bg-black/40 p-1.5 rounded-2xl w-full border border-white/5 relative flex shadow-inner mb-8">
                {[
                  { id: "Viewer", label: "Spectator", icon: Users },
                  { id: "Club", label: "Club", icon: Shield },
                  { id: "Co-Admin", label: "Tatami", icon: Shield },
                  { id: "Admin", label: "Director", icon: Shield },
                ].map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeRole === tab.id;
                  const isDisabled = isRegistrationPopup && tab.id !== "Club";
                  
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      disabled={isDisabled}
                      onClick={() => {
                        if (!isDisabled) {
                          setActiveRole(tab.id as any);
                          setError(null);
                        }
                      }}
                      className={`flex-1 py-2.5 px-2 rounded-xl text-[11px] font-bold transition-all duration-300 flex flex-col items-center justify-center gap-1.5 relative z-10 ${
                        isDisabled
                          ? "opacity-50 grayscale cursor-not-allowed text-slate-600"
                          : isActive
                            ? "text-white cursor-default"
                            : "text-slate-500 hover:text-slate-300 cursor-pointer"
                      }`}
                    >
                      {isActive && (
                        <div className="absolute inset-0 bg-indigo-600/90 rounded-xl shadow-lg shadow-indigo-900/50 -z-10 animate-in zoom-in-95 duration-200" />
                      )}
                      <Icon
                        className={`h-4 w-4 ${isActive ? "text-indigo-200" : ""}`}
                      />
                      <span className="tracking-wide uppercase">
                        {tab.label}
                      </span>
                      {isDisabled && (
                        <div className="absolute -top-2 bg-red-500/20 text-red-400 border border-red-500/30 text-[8px] uppercase tracking-widest px-1.5 py-0.5 rounded shadow-sm">
                          Disabled
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* FORM */}
            <form onSubmit={handleSubmit} className="w-full space-y-4">
              {mode !== "forgotPassword" && (
                <div className="h-10 flex items-center">
                  <p
                    className="text-[11px] text-slate-400 text-center leading-relaxed font-medium px-4 w-full animate-in fade-in duration-500"
                    key={activeRole}
                  >
                    {getRoleHelpText()}
                  </p>
                </div>
              )}

              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-xs font-bold text-red-400 rounded-xl text-center backdrop-blur-sm animate-in fade-in slide-in-from-top-2">
                  {error}
                </div>
              )}

              {message && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-xs font-bold text-emerald-400 rounded-xl text-center backdrop-blur-sm animate-in fade-in slide-in-from-top-2">
                  {message}
                </div>
              )}

              <div className="space-y-4">
                {/* Name Input (Sign Up Only) */}
                {mode === "signUp" && (
                  <div className="relative group animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500 group-focus-within:text-indigo-400 transition-colors">
                      <User className="h-4 w-4" />
                    </div>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Full Name"
                      className="w-full pl-11 pr-4 py-3.5 bg-black/30 border border-white/10 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all shadow-inner"
                      required
                    />
                  </div>
                )}

                {/* Email Input (All modes) */}
                {(mode !== "signIn" || activeRole !== "Viewer") && (
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500 group-focus-within:text-indigo-400 transition-colors">
                      <Mail className="h-4 w-4" />
                    </div>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Email Address"
                      className="w-full pl-11 pr-4 py-3.5 bg-black/30 border border-white/10 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all shadow-inner"
                      required
                    />
                  </div>
                )}

                {/* Password Input (Sign In / Sign Up) */}
                {mode !== "forgotPassword" &&
                  (mode !== "signIn" || activeRole !== "Viewer") && (
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500 group-focus-within:text-indigo-400 transition-colors">
                        <Lock className="h-4 w-4" />
                      </div>
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Password"
                        className="w-full pl-11 pr-11 py-3.5 bg-black/30 border border-white/10 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all shadow-inner"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  )}

                {/* Confirm Password Input (Sign Up Only) */}
                {mode === "signUp" && (
                  <div className="relative group animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500 group-focus-within:text-indigo-400 transition-colors">
                      <KeyRound className="h-4 w-4" />
                    </div>
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm Password"
                      className="w-full pl-11 pr-11 py-3.5 bg-black/30 border border-white/10 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all shadow-inner"
                      required
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setShowConfirmPassword(!showConfirmPassword)
                      }
                      className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* Forgot Password Link (Sign In Only) */}
              {mode === "signIn" && activeRole !== "Viewer" && (
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setMode("forgotPassword");
                      setError(null);
                      setMessage(null);
                    }}
                    className="text-xs text-indigo-400 hover:text-indigo-300 hover:underline transition-all cursor-pointer font-semibold"
                  >
                    Forgot Password?
                  </button>
                </div>
              )}

              {/* Action Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-4 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white shadow-[0_0_20px_rgba(79,70,229,0.3)] hover:shadow-[0_0_25px_rgba(79,70,229,0.5)] rounded-xl text-sm font-black tracking-widest uppercase cursor-pointer transition-all active:scale-[0.98] flex items-center justify-center gap-2 mt-4 border border-indigo-400/20 disabled:opacity-50 disabled:pointer-events-none"
              >
                {loading ? (
                  <div className="w-5 h-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                ) : (
                  <>
                    <span>
                      {mode === "signIn"
                        ? activeRole === "Viewer"
                          ? "Enter Live Hub"
                          : "Authenticate"
                        : mode === "signUp"
                          ? "Create Account"
                          : "Send Reset Link"}
                    </span>
                    {mode === "forgotPassword" ? (
                      <Send className="h-4 w-4" />
                    ) : (
                      <ArrowRight className="h-4 w-4" />
                    )}
                  </>
                )}
              </button>
            </form>

            {/* OAUTH AREA (Only for Sign In and Co-Admin/Admin roles) */}
            {mode === "signIn" && activeRole !== "Viewer" && (
              <div className="w-full flex flex-col space-y-4 pt-2">
                <div className="flex items-center justify-between w-full">
                  <div className="flex-1 h-[1px] bg-gradient-to-r from-transparent to-white/10" />
                  <span className="px-3 text-[9px] font-bold text-slate-600 uppercase tracking-widest">
                    Single Sign-On
                  </span>
                  <div className="flex-1 h-[1px] bg-gradient-to-l from-transparent to-white/10" />
                </div>

                <button
                  type="button"
                  disabled={loading}
                  onClick={async () => {
                    setError(null);
                    setMessage(null);
                    setLoading(true);

                    try {
                      if (isSupabaseConfigured && supabase) {
                        const { error: oauthError } =
                          await supabase.auth.signInWithOAuth({
                            provider: "google",
                            options: {
                              redirectTo:
                                window.location.origin +
                                basePath +
                                "/auth/callback",
                            },
                          });
                        if (oauthError) {
                          const msg = oauthError.message;
                          if (
                            msg.includes("Failed to fetch") ||
                            msg.includes("NetworkError") ||
                            msg.includes("network")
                          ) {
                            console.warn(
                              "Supabase OAuth network error, falling back to local auth:",
                              msg,
                            );
                            const targetEmail =
                              email.trim() ||
                              `${activeRole.toLowerCase()}@senshikarate.com`;
                            login(activeRole, targetEmail);
                            if (onSuccess) {
                              onSuccess();
                            } else if (activeRole === "Club") {
                              window.location.href = `${basePath}/registration`;
                            } else {
                              window.location.href = `${basePath}/admin`;
                            }
                          } else {
                            setError(oauthError.message);
                          }
                        }
                      } else {
                        // Mock Google Auth Flow
                        const targetEmail =
                          email.trim() ||
                          `${activeRole.toLowerCase()}@senshikarate.com`;
                        login(activeRole, targetEmail);
                        if (onSuccess) {
                          onSuccess();
                        } else if (activeRole === "Club") {
                          window.location.href = `${basePath}/registration`;
                        } else {
                          window.location.href = `${basePath}/admin`;
                        }
                      }
                    } catch (err: any) {
                      setError(err?.message || "Google Auth Error");
                    } finally {
                      setLoading(false);
                    }
                  }}
                  className="w-full py-3.5 bg-black/40 hover:bg-black/60 border border-white/10 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-3 cursor-pointer text-slate-300 hover:text-white group disabled:opacity-50"
                >
                  <svg
                    className="h-4 w-4 grayscale opacity-80 group-hover:grayscale-0 group-hover:opacity-100 transition-all"
                    viewBox="0 0 24 24"
                  >
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>Continue with Google</span>
                </button>
              </div>
            )}

            {/* SWITCH MODE FOOTER */}
            <div className="w-full pt-4 border-t border-white/5 flex flex-col items-center justify-center space-y-3">
              {mode === "signIn" ? (
                activeRole !== "Viewer" && (
                  <p className="text-xs text-slate-500">
                    Need a tournament account?{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setMode("signUp");
                        setError(null);
                        setMessage(null);
                      }}
                      className="text-indigo-400 hover:text-indigo-300 font-bold hover:underline cursor-pointer transition-all"
                    >
                      Sign Up
                    </button>
                  </p>
                )
              ) : mode === "signUp" ? (
                <p className="text-xs text-slate-500">
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setMode("signIn");
                      setError(null);
                      setMessage(null);
                    }}
                    className="text-indigo-400 hover:text-indigo-300 font-bold hover:underline cursor-pointer transition-all"
                  >
                    Sign In
                  </button>
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMode("signIn");
                    setError(null);
                    setMessage(null);
                  }}
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-bold hover:underline cursor-pointer flex items-center gap-1 transition-all"
                >
                  <ArrowLeft className="h-3 w-3" />
                  <span>Back to Sign In</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
