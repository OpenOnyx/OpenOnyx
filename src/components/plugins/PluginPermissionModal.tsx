/**
 * Plugin Permission Modal
 *
 * Shown when a plugin requests permissions that haven't been approved yet.
 * Displays the requested permissions with risk levels and descriptions.
 * Icon-free and emoji-free to match system rules.
 */

import React from 'react';
import type { PluginManifest, PluginPermission } from '../../types/plugin';
import { PERMISSION_DESCRIPTIONS } from '../../types/plugin';

interface PluginPermissionModalProps {
  manifest: PluginManifest;
  permissions: PluginPermission[];
  onApprove: () => void;
  onDeny: () => void;
}

const RISK_COLORS: Record<string, string> = {
  low: 'var(--success, #22c55e)',
  medium: 'var(--warning, #f59e0b)',
  high: 'var(--danger, #ef4444)',
};

const RISK_BG: Record<string, string> = {
  low: 'rgba(34,197,94,0.08)',
  medium: 'rgba(245,158,11,0.08)',
  high: 'rgba(239,68,68,0.08)',
};

export function PluginPermissionModal({
  manifest,
  permissions,
  onApprove,
  onDeny,
}: PluginPermissionModalProps) {
  const hasHighRisk = permissions.some(
    p => PERMISSION_DESCRIPTIONS[p]?.risk === 'high'
  );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Backdrop */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.65)',
          backdropFilter: 'blur(5px)',
        }}
        onClick={onDeny}
      />

      {/* Modal Container */}
      <div
        style={{
          position: 'relative',
          background: 'var(--bg-primary, #181825)',
          border: '1px solid var(--border-medium, rgba(255,255,255,0.08))',
          borderRadius: '8px',
          padding: '24px',
          maxWidth: '440px',
          width: '90vw',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          zIndex: 1,
          fontFamily: 'var(--font-interface, system-ui, sans-serif)',
        }}
      >
        {/* Close Button */}
        <button
          onClick={onDeny}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            background: 'none',
            border: 'none',
            color: 'var(--text-muted, #888)',
            cursor: 'pointer',
            padding: '4px',
            fontSize: '14px',
            fontWeight: 500,
          }}
        >
          X
        </button>

        {/* Header */}
        <div style={{ marginBottom: '18px' }}>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Plugin Permissions
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
            <strong>{manifest.name}</strong> v{manifest.version} by {manifest.author}
          </p>
        </div>

        {/* Description */}
        <p style={{
          fontSize: '12px',
          color: 'var(--text-secondary, #b8b8b8)',
          lineHeight: 1.5,
          margin: '0 0 16px 0',
        }}>
          This plugin requires the following permissions to function. Review them carefully before enabling.
        </p>

        {/* Permission List */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          marginBottom: '20px',
        }}>
          {permissions.map(perm => {
            const desc = PERMISSION_DESCRIPTIONS[perm];
            if (!desc) return null;

            return (
              <div
                key={perm}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '8px 12px',
                  background: 'var(--bg-secondary, rgba(255,255,255,0.02))',
                  borderRadius: '6px',
                  border: `1px solid ${desc.risk === 'high' ? 'rgba(239,68,68,0.15)' : 'var(--border-subtle, rgba(255,255,255,0.04))'}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '12.5px', fontWeight: 500, color: 'var(--text-primary)' }}>
                    {desc.label}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', lineHeight: '1.4' }}>
                    {desc.description}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: '9px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: RISK_COLORS[desc.risk],
                    background: RISK_BG[desc.risk],
                    padding: '2px 6px',
                    borderRadius: '4px',
                    flexShrink: 0,
                  }}
                >
                  {desc.risk}
                </div>
              </div>
            );
          })}
        </div>

        {/* High Risk Warning Message */}
        {hasHighRisk && (
          <div style={{
            padding: '10px 12px',
            background: 'rgba(239,68,68,0.04)',
            border: '1px solid rgba(239,68,68,0.12)',
            borderRadius: '6px',
            fontSize: '11.5px',
            color: 'var(--text-secondary, #fca5a5)',
            lineHeight: 1.4,
            marginBottom: '20px',
          }}>
            This plugin requests high-risk permissions. Only enable if you trust the author.
          </div>
        )}

        {/* Actions Button Row */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={onDeny}
            style={{
              background: 'transparent',
              border: '1px solid var(--border-subtle, rgba(255,255,255,0.1))',
              borderRadius: '6px',
              padding: '7px 16px',
              color: 'var(--text-secondary)',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Deny
          </button>
          <button
            onClick={onApprove}
            style={{
              background: hasHighRisk ? 'var(--danger, #ef4444)' : 'var(--accent-primary, var(--oo-accent, #E8A84A))',
              border: 'none',
              borderRadius: '6px',
              padding: '7px 16px',
              color: 'var(--text-on-accent, #ffffff)',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Allow & Enable
          </button>
        </div>
      </div>
    </div>
  );
}
