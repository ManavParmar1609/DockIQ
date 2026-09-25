import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api';
import { SeverityBadge } from '../../components/Shared';
import { ArrowLeft, Sparkles, User, Clock, MapPin, CheckCircle, AlertTriangle } from 'lucide-react';

const RESOLUTION_TYPES = ['Accept', 'Partial Accept', 'Full Reject', 'Override — Accept Anyway', 'Request Re-inspection', 'Contact Carrier', 'Other'];

export default function IssueDetail() {
  const { issueId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [issue, setIssue] = useState(null);
  const [resType, setResType] = useState('');
  const [notes, setNotes] = useState('');
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    api.getIssue(issueId).then(setIssue);
  }, [issueId]);

  const handleResolve = async () => {
    await api.supervisorResolve(issueId, {
      supervisor_id: user.id,
      resolution_type: resType,
      supervisor_notes: notes,
    });
    setResolved(true);
  };

  if (!issue) return <div className="text-gray-500 text-center py-12">Loading...</div>;

  if (resolved) {
    return (
      <div className="max-w-xl mx-auto glass p-8 text-center animate-in">
        <CheckCircle className="w-16 h-16 text-emerald-600 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900">Issue Resolved</h2>
        <p className="text-gray-500 mt-2">Resolution has been logged and the worker has been notified.</p>
        <button onClick={() => navigate('/app')} className="mt-6 px-6 py-2 rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200">
          Back to Dashboard
        </button>
      </div>
    );
  }

  const aiRes = typeof issue.ai_resolution === 'string' ? JSON.parse(issue.ai_resolution) : issue.ai_resolution;
  const elapsed = issue.escalated_at ? Math.round((Date.now() - new Date(issue.escalated_at).getTime()) / 60000) : null;

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-in">
      <button onClick={() => navigate('/app')} className="text-gray-500 hover:text-gray-900 text-sm flex items-center gap-1">
        <ArrowLeft size={14} /> Back to Dashboard
      </button>

      {/* Header */}
      <div className="glass p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-3">
              {issue.issue_type}
              <SeverityBadge severity={issue.severity} />
            </h1>
            <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
              <span className="flex items-center gap-1"><MapPin size={14} /> Dock {issue.door_number}</span>
              <span className="flex items-center gap-1"><User size={14} /> {issue.operator_name}</span>
              <span className="flex items-center gap-1"><Clock size={14} /> {elapsed !== null ? `${elapsed}m since escalation` : new Date(issue.created_at).toLocaleString()}</span>
            </div>
          </div>
          <span className="text-2xl font-bold text-amber-600">#{issue.id}</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div className="p-3 rounded-lg bg-gray-50">
            <p className="text-xs text-gray-500">Customer</p>
            <p className="font-medium text-gray-900">{issue.company_name || 'N/A'}</p>
          </div>
          <div className="p-3 rounded-lg bg-gray-50">
            <p className="text-xs text-gray-500">Product</p>
            <p className="font-medium text-gray-900 truncate">{issue.product_name || 'N/A'}</p>
          </div>
          <div className="p-3 rounded-lg bg-gray-50">
            <p className="text-xs text-gray-500">Carrier</p>
            <p className="font-medium text-gray-900">{issue.carrier_name || 'N/A'}</p>
          </div>
          <div className="p-3 rounded-lg bg-gray-50">
            <p className="text-xs text-gray-500">Cost Impact</p>
            <p className="font-medium text-amber-600">${(issue.estimated_cost_impact || 0).toFixed(2)}</p>
          </div>
        </div>
      </div>

      {/* Description & Tags */}
      {(issue.description || issue.quick_tags?.length > 0) && (
        <div className="glass p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Worker Description</h3>
          {issue.description && <p className="text-sm text-gray-500">{issue.description}</p>}
          {issue.quick_tags?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {issue.quick_tags.map(tag => (
                <span key={tag} className="px-2 py-0.5 rounded-full bg-gray-100 text-xs text-gray-500">{tag}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Severity Explanation */}
      <div className="glass p-5 border-l-4 border-l-amber-400">
        <h3 className="text-sm font-semibold text-amber-600 mb-2">🧠 AI Severity Classification</h3>
        <p className="text-sm text-gray-500">{issue.severity_reason}</p>
      </div>

      {/* AI Resolution (what was suggested to worker) */}
      {aiRes && (
        <div className="glass p-5 border-l-4 border-l-blue-500">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-blue-600">AI Resolution Suggested to Worker</h3>
            <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
              aiRes.confidence === 'high' ? 'bg-emerald-50 text-emerald-600' :
              aiRes.confidence === 'medium' ? 'bg-amber-50 text-amber-600' :
              'bg-red-50 text-red-600'
            }`}>{aiRes.confidence?.toUpperCase()} confidence</span>
          </div>
          {aiRes.scenario && <p className="text-xs text-gray-500 mb-2">Scenario: {aiRes.scenario}</p>}
          <div className="space-y-1">
            {(aiRes.steps || []).map((s, i) => (
              <p key={i} className="text-sm text-gray-700"><span className="text-blue-600 font-bold mr-2">{i + 1}.</span>{s}</p>
            ))}
          </div>
          {aiRes.source && <p className="text-xs text-gray-500 mt-2">Source: {aiRes.source}</p>}
          <p className="text-xs text-red-600 mt-2 font-semibold"><AlertTriangle size={13} className="inline mr-1" />Worker could not resolve with this guidance — escalated to you.</p>
        </div>
      )}

      {/* Supervisor Resolution */}
      <div className="glass p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Resolve This Issue</h3>
        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-500 mb-2 block">Resolution Action:</label>
            <div className="flex flex-wrap gap-2">
              {RESOLUTION_TYPES.map(rt => (
                <button
                  key={rt}
                  onClick={() => setResType(rt)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                    resType === rt ? 'bg-blue-50 text-blue-600 border border-blue-200' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-transparent'
                  }`}
                >{rt}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm text-gray-500 mb-2 block">Supervisor Notes:</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add your resolution notes..."
              className="w-full bg-gray-100 border border-gray-200 rounded-xl px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-[#0071e3]/20 h-24 resize-none"
            />
          </div>
          <button
            onClick={handleResolve}
            disabled={!resType}
            className="w-full py-3 bg-blue-600 rounded-xl font-semibold text-white hover:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Resolve Issue
          </button>
        </div>
      </div>
    </div>
  );
}
