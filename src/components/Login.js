import React from 'react';
import { useAuth } from '../contexts/AuthContext';

const Login = () => {
  const { signInWithGitHub } = useAuth();

  const handleGitHubLogin = async () => {
    try {
      await signInWithGitHub();
    } catch (error) {
      console.error('Error signing in:', error.message);
      alert('Login failed: ' + error.message);
    }
  };

  return (
    <div style={{ 
      minHeight: '100vh', // Changed from height to minHeight
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      margin: 0, // Ensure no margin
    }}>
      <div style={{
        background: 'rgba(255, 255, 255, 0.95)',
        borderRadius: '20px',
        padding: '40px',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.1)',
        maxWidth: '480px',
        width: '100%',
        textAlign: 'center',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.2)'
      }}>
        {/* Header Section */}
        <div style={{ marginBottom: '32px' }}>
          <div style={{
            width: '80px',
            height: '80px',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
            fontSize: '2.5rem'
          }}>
            ⚡
          </div>
          <h1 style={{
            fontSize: '2rem',
            fontWeight: '700',
            color: '#2d3748',
            marginBottom: '12px',
            lineHeight: '1.2'
          }}>
            Self-Healing GitHub Agent
          </h1>
          <p style={{
            color: '#718096',
            fontSize: '1.1rem',
            lineHeight: '1.5',
            margin: '0'
          }}>
            Automatically detect and fix failed GitHub workflows with AI-powered healing
          </p>
        </div>

        {/* Login Button */}
        <button
          onClick={handleGitHubLogin}
          style={{
            width: '100%',
            padding: '16px 24px',
            backgroundColor: '#24292e',
            color: 'white',
            border: 'none',
            borderRadius: '12px',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            transition: 'all 0.2s ease',
            marginBottom: '32px',
            boxShadow: '0 4px 12px rgba(36, 41, 46, 0.2)'
          }}
          onMouseOver={(e) => {
            e.target.style.transform = 'translateY(-2px)';
            e.target.style.boxShadow = '0 6px 16px rgba(36, 41, 46, 0.3)';
          }}
          onMouseOut={(e) => {
            e.target.style.transform = 'translateY(0)';
            e.target.style.boxShadow = '0 4px 12px rgba(36, 41, 46, 0.2)';
          }}
        >
          <svg height="20" viewBox="0 0 16 16" width="20" fill="white">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
          Sign in with GitHub
        </button>

        {/* Features Section */}
        <div style={{
          background: 'linear-gradient(135deg, #f7fafc 0%, #edf2f7 100%)',
          borderRadius: '16px',
          padding: '24px',
          border: '1px solid #e2e8f0'
        }}>
          <h3 style={{
            fontSize: '1.25rem',
            fontWeight: '600',
            color: '#2d3748',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px'
          }}>
            <span></span> How it works
          </h3>
          <ul style={{
            textAlign: 'left',
            color: '#4a5568',
            lineHeight: '1.6',
            margin: '0',
            paddingLeft: '20px'
          }}>
            <li style={{ marginBottom: '12px' }}>
              <strong>Monitor</strong> your GitHub repositories for workflow failures
            </li>
            <li style={{ marginBottom: '12px' }}>
              <strong>AI analyzes</strong> errors and suggests fixes automatically
            </li>
            <li style={{ marginBottom: '12px' }}>
              <strong>Auto-create</strong> pull requests with the proposed solutions
            </li>
            <li style={{ marginBottom: '0' }}>
              <strong>Get notified</strong> on Slack when fixes are applied
            </li>
          </ul>
        </div>

        {/* Footer Note */}
        <p style={{
          marginTop: '24px',
          color: '#a0aec0',
          fontSize: '0.875rem',
          lineHeight: '1.4'
        }}>
          Secure authentication via GitHub OAuth • Read-only access to workflows
        </p>
      </div>
    </div>
  );
};

export default Login;