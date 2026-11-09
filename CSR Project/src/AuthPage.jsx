import React, { useState } from 'react';
import './AuthPage.css';
import { readApiJson } from './api.js';

function AuthPage({ onContinueAsGuest, onAuthenticated, connectionError }) {
  const [mode, setMode] = useState('signup');
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inviteDetails = new URLSearchParams(window.location.hash.slice(1));
  const inviteToken = inviteDetails.get('invite') || '';
  const invitedEmail = inviteDetails.get('email') || '';
  const isInvite = Boolean(inviteToken);

  function switchMode(nextMode) {
    setMode(nextMode);
    setNotice('');
    setErrorMessage('');
    setShowPassword(false);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setNotice('');
    setErrorMessage('');

    const formData = new FormData(event.currentTarget);
    const body = {
      name: String(formData.get('name') || ''),
      schoolName: String(formData.get('schoolName') || ''),
      inviteToken,
      email: String(formData.get('email') || ''),
      password: String(formData.get('password') || ''),
      updates: formData.get('updates') === 'on',
      remember: formData.get('remember') === 'on',
    };
    setIsSubmitting(true);

    try {
      const response = await fetch(isSignUp ? '/api/auth/signup' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      const result = await readApiJson(response);
      onAuthenticated(result.user);
    } catch (error) {
      setErrorMessage(error instanceof TypeError
        ? 'Could not connect to the account service. Make sure the project server is running.'
        : error instanceof Error ? error.message : 'Could not complete account access. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const isSignUp = mode === 'signup';

  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="About Empower Hope">
        <a className="auth-brand" href="#home" onClick={(event) => { event.preventDefault(); onContinueAsGuest(); }}>
          <span className="auth-brand-mark">EH</span>
          <span>Empower Hope<small>LEARNING PORTAL</small></span>
        </a>

        <div className="auth-story-copy">
          <span className="auth-kicker"><span aria-hidden="true">✦</span> LEARN WITHOUT LIMITS</span>
          <h1>Every learner<br />deserves a chance<br />to <em>shine.</em></h1>
          <p>Find free learning resources, build digital skills, and grow together with your school community.</p>
        </div>

        <div className="auth-story-footer">
          <div className="auth-people" aria-hidden="true"><span>A</span><span>J</span><span>M</span><span>+</span></div>
          <p><strong>Learning belongs to everyone.</strong><br />Made for connected and offline classrooms.</p>
        </div>
        <span className="auth-decoration auth-decoration-one" aria-hidden="true"></span>
        <span className="auth-decoration auth-decoration-two" aria-hidden="true"></span>
      </section>

      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="auth-form-wrap">
          <div className="auth-mobile-brand">
            <span className="auth-brand-mark">EH</span>
            <span>Empower Hope<small>LEARNING PORTAL</small></span>
          </div>

          <div className="auth-heading">
            <p className="auth-overline">{isSignUp ? isInvite ? 'JOIN YOUR SCHOOL TEAM' : 'SCHOOL ONBOARDING' : 'WELCOME BACK'}</p>
            <h2 id="auth-title">{isSignUp ? isInvite ? 'Join your school' : 'Set up your school' : 'Good to see you again'}</h2>
            <p>{isSignUp ? isInvite ? 'Create your account to accept the school invitation.' : 'Create the first school administrator account for your school.' : 'Sign in to continue learning and sharing.'}</p>
          </div>

          <div className="auth-tabs" role="tablist" aria-label="Account access">
            <button id="signup-tab" className={isSignUp ? 'is-selected' : ''} type="button" role="tab" aria-selected={isSignUp} aria-controls="auth-form" onClick={() => switchMode('signup')}>Create account</button>
            <button id="login-tab" className={!isSignUp ? 'is-selected' : ''} type="button" role="tab" aria-selected={!isSignUp} aria-controls="auth-form" onClick={() => switchMode('login')}>Log in</button>
          </div>

          <form id="auth-form" className="auth-form" onSubmit={handleSubmit} aria-labelledby={isSignUp ? 'signup-tab' : 'login-tab'}>
            {isSignUp && (
              <>
                <label className="auth-field">Full name
                  <input autoComplete="name" maxLength={120} minLength={2} name="name" placeholder="e.g. Amina Wanjiku" required />
                </label>
                {!isInvite && <label className="auth-field">School name
                  <input autoComplete="organization" maxLength={160} minLength={2} name="schoolName" placeholder="e.g. Kibera Hope Academy" required />
                </label>}
              </>
            )}
            <label className="auth-field">Email address
              <input autoComplete="email" defaultValue={isInvite ? invitedEmail : ''} maxLength={254} name="email" type="email" placeholder="you@example.com" required />
            </label>
            <label className="auth-field">Password
              <span className="auth-password-wrap">
                <input autoComplete={isSignUp ? 'new-password' : 'current-password'} maxLength={128} minLength={8} name="password" placeholder="At least 8 characters" required type={showPassword ? 'text' : 'password'} />
                <button className="auth-show-password" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button>
              </span>
            </label>
            {isSignUp ? (
              <label className="auth-consent"><input name="updates" type="checkbox" /><span>Send me occasional updates about new learning resources.</span></label>
            ) : (
              <label className="auth-consent"><input name="remember" type="checkbox" /><span>Remember me on this device</span></label>
            )}
            {connectionError && <p className="auth-error" role="alert">{connectionError}</p>}
            {notice && <p className="auth-notice" role="status">{notice}</p>}
            {errorMessage && <p className="auth-error" role="alert">{errorMessage}</p>}
            <button className="auth-submit" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Please wait…' : isSignUp ? 'Create account' : 'Log in'}<span aria-hidden="true">→</span></button>
          </form>

          <div className="auth-divider"><span>OR</span></div>
          <button className="auth-guest" type="button" onClick={onContinueAsGuest}>Explore the portal as a guest <span aria-hidden="true">↗</span></button>
          <p className="auth-privacy">Your account and school records are stored in the school's secured database.</p>
        </div>
      </section>
    </main>
  );
}

export default AuthPage;
