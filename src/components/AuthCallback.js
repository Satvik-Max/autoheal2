import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const AuthCallback = () => {
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('Session error:', error);
          setError(error.message);
          return;
        }

        if (session) {
          console.log('User signed in:', session.user);
          navigate('/');
        } else {
          const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, session) => {
              console.log('Auth state changed:', event);
              
              if (event === 'SIGNED_IN') {
                navigate('/');
              } else if (event === 'AUTH_ERROR') {
                setError('Authentication failed');
              }
              
              subscription.unsubscribe();
            }
          );
        }
      } catch (err) {
        console.error('Auth callback error:', err);
        setError(err.message);
      }
    };

    handleAuthCallback();
  }, [navigate]);

  if (error) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        flexDirection: 'column' 
      }}>
        <h2 style={{ color: 'red' }}>Authentication Error</h2>
        <p>{error}</p>
        <button onClick={() => navigate('/')}>Go Home</button>
      </div>
    );
  }

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      height: '100vh' 
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '20px' }}>⚡</div>
        <h2>Completing authentication...</h2>
        <p>Redirecting to your dashboard</p>
      </div>
    </div>
  );
};

export default AuthCallback;