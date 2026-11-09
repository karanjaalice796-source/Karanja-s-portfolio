import React, { useEffect, useState } from 'react';
import { readApiJson } from './api.js';
import './school-pilot.css';

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

async function getJson(url) {
  return readApiJson(await fetch(url, { credentials: 'same-origin' }));
}

async function postJson(url, method, body) {
  return readApiJson(await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  }));
}

function SchoolPilot({ view, user }) {
  const [students, setStudents] = useState([]);
  const [payments, setPayments] = useState([]);
  const [members, setMembers] = useState([]);
  const [date, setDate] = useState(today);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [refresh, setRefresh] = useState(0);
  const isAdmin = user.role === 'school_admin';
  const canRecordAttendance = isAdmin || user.role === 'teacher';
  const canRecordFees = isAdmin || user.role === 'bursar';

  useEffect(() => {
    let active = true;
    setLoading(true);

    const request = view === 'school'
      ? getJson('/api/pilot/members').then((result) => {
        if (active) setMembers(result.members);
      })
      : view === 'attendance'
        ? getJson(`/api/pilot/attendance?date=${encodeURIComponent(date)}`).then((result) => {
          if (active) setStudents(result.students);
        })
        : Promise.all([getJson('/api/pilot/students'), getJson('/api/pilot/fees')]).then(([studentResult, paymentResult]) => {
          if (active) {
            setStudents(studentResult.students);
            setPayments(paymentResult.payments);
          }
        });

    request.catch((requestError) => {
      if (active) setError(requestError instanceof Error ? requestError.message : 'Could not load school records.');
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [view, date, refresh]);

  useEffect(() => {
    setError('');
    setMessage('');
    setInviteUrl('');
  }, [view, date]);

  async function addStudent(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setSaving(true);
    setError('');
    setMessage('');
    const data = new FormData(event.currentTarget);
    try {
      await postJson('/api/pilot/students', 'POST', {
        fullName: data.get('fullName'),
        admissionNo: data.get('admissionNo'),
      });
      form.reset();
      setMessage('Student added to this school.');
      setRefresh((value) => value + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not add the student.');
    } finally {
      setSaving(false);
    }
  }

  async function saveAttendance(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    const entries = Array.from(event.currentTarget.elements)
      .filter((element) => element instanceof HTMLSelectElement && element.name === 'status')
      .map((element) => ({
        studentId: element.dataset.studentId,
        status: element.value,
        note: '',
      }));
    try {
      await postJson('/api/pilot/attendance', 'PUT', { date, entries });
      setMessage(`Attendance saved for ${entries.length} students.`);
      setRefresh((value) => value + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save attendance.');
    } finally {
      setSaving(false);
    }
  }

  async function recordPayment(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setSaving(true);
    setError('');
    setMessage('');
    const data = new FormData(event.currentTarget);
    try {
      await postJson('/api/pilot/fees', 'POST', {
        studentId: data.get('studentId'),
        amount: data.get('amount'),
        method: data.get('method'),
        reference: data.get('reference'),
        note: data.get('note'),
        date: data.get('date'),
      });
      form.reset();
      setMessage('Fee payment recorded.');
      setRefresh((value) => value + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not record the payment.');
    } finally {
      setSaving(false);
    }
  }

  async function inviteMember(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setSaving(true);
    setError('');
    setMessage('');
    const data = new FormData(event.currentTarget);
    try {
      const result = await postJson('/api/pilot/invitations', 'POST', {
        email: data.get('email'),
        role: data.get('role'),
      });
      const url = new URL('/', window.location.origin);
      url.hash = new URLSearchParams({ invite: result.token, email: result.email }).toString();
      setInviteUrl(url.toString());
      setMessage(`Invitation created for ${result.email}. Share this link within 7 days.`);
      form.reset();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not create the invitation.');
    } finally {
      setSaving(false);
    }
  }

  const title = view === 'attendance' ? 'Daily attendance' : view === 'fees' ? 'Fee register' : 'School & team';

  return (
    <section className="school-pilot" aria-labelledby="pilot-title">
      <header className="pilot-heading">
        <div>
          <p className="eyebrow">{user.school.name} · {user.role.replace('_', ' ')}</p>
          <h2 id="pilot-title">{title}</h2>
        </div>
        <p>Records are scoped to this school.</p>
      </header>

      {error && <p className="pilot-message pilot-error" role="alert">{error}</p>}
      {message && <p className="pilot-message pilot-success" role="status">{message}</p>}
      {loading ? <p className="pilot-empty" role="status">Loading school records…</p> : (
        <>
          {view === 'school' && (
            <div className="pilot-columns">
              <section className="pilot-card" aria-labelledby="school-info-title">
                <p className="eyebrow">SCHOOL WORKSPACE</p>
                <h3 id="school-info-title">{user.school.name}</h3>
                <p>Share the school team links only with the invited staff member. Each invitation is limited to its email address and expires after seven days.</p>
                <p className="pilot-small">Role: <strong>{user.role.replace('_', ' ')}</strong></p>
              </section>
              <section className="pilot-card" aria-labelledby="invite-title">
                <p className="eyebrow">SCHOOL ADMINISTRATOR</p>
                <h3 id="invite-title">Invite a team member</h3>
                <form className="pilot-form" onSubmit={inviteMember}>
                  <label>Email address<input name="email" type="email" autoComplete="email" maxLength="254" required /></label>
                  <label>School role<select name="role" defaultValue="teacher"><option value="teacher">Teacher — attendance and roster</option><option value="bursar">Bursar — fee register</option></select></label>
                  <button className="auth-submit pilot-submit" type="submit" disabled={saving}>{saving ? 'Please wait…' : 'Create invitation'}<span aria-hidden="true">→</span></button>
                </form>
                {inviteUrl && <label className="pilot-invite-link">Invitation link<input readOnly value={inviteUrl} onFocus={(event) => event.target.select()} /></label>}
              </section>
              <section className="pilot-card pilot-card-wide" aria-labelledby="members-title">
                <p className="eyebrow">SCHOOL ACCESS</p>
                <h3 id="members-title">Team members</h3>
                {members.length ? <div className="pilot-table-wrap"><table className="pilot-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>{members.map((member) => <tr key={member.email}><td>{member.fullName}</td><td>{member.email}</td><td>{member.role.replace('_', ' ')}</td></tr>)}</tbody></table></div> : <p className="pilot-empty">No team members yet.</p>}
              </section>
            </div>
          )}

          {view === 'attendance' && (
            <div className="pilot-columns">
              <section className="pilot-card" aria-labelledby="roster-title">
                <p className="eyebrow">SCHOOL ROSTER</p>
                <h3 id="roster-title">Add a student</h3>
                {canRecordAttendance ? <form className="pilot-form" onSubmit={addStudent}>
                  <label>Student name<input name="fullName" autoComplete="name" minLength="2" maxLength="120" required /></label>
                  <label>Admission number<input name="admissionNo" maxLength="40" required /></label>
                  <button className="auth-submit pilot-submit" type="submit" disabled={saving}>{saving ? 'Please wait…' : 'Add student'}<span aria-hidden="true">→</span></button>
                </form> : <p>Only a school administrator or teacher can add students.</p>}
              </section>
              <section className="pilot-card pilot-card-wide" aria-labelledby="attendance-title">
                <div className="pilot-card-heading"><div><p className="eyebrow">DAILY REGISTER</p><h3 id="attendance-title">Mark attendance</h3></div><label className="pilot-date">Date<input type="date" value={date} max={today()} onChange={(event) => setDate(event.target.value)} /></label></div>
                {!students.length ? <p className="pilot-empty">Add students to this school roster before taking attendance.</p> : <form onSubmit={saveAttendance}>
                  <div className="pilot-table-wrap"><table className="pilot-table"><thead><tr><th>Student</th><th>Admission no.</th><th>Attendance</th></tr></thead><tbody>{students.map((student) => <tr key={student.id}><td>{student.fullName}</td><td>{student.admissionNo}</td><td><select aria-label={`Attendance for ${student.fullName}`} data-student-id={student.id} name="status" required defaultValue={student.status || ''}><option value="" disabled>Choose status</option><option value="present">Present</option><option value="absent">Absent</option><option value="late">Late</option><option value="excused">Excused</option></select></td></tr>)}</tbody></table></div>
                  <button className="auth-submit pilot-submit" type="submit" disabled={saving || !canRecordAttendance}>{saving ? 'Saving…' : 'Save attendance'}<span aria-hidden="true">→</span></button>
                </form>}
              </section>
            </div>
          )}

          {view === 'fees' && (
            <div className="pilot-columns">
              <section className="pilot-card" aria-labelledby="payment-title">
                <p className="eyebrow">MANUAL PAYMENT RECORDING</p>
                <h3 id="payment-title">Record a fee payment</h3>
                {!students.length ? <p>Add students to the school roster before recording payments.</p> : canRecordFees ? <form className="pilot-form" onSubmit={recordPayment}>
                  <label>Student<select name="studentId" required defaultValue=""><option value="" disabled>Select a student</option>{students.map((student) => <option key={student.id} value={student.id}>{student.fullName} · {student.admissionNo}</option>)}</select></label>
                  <label>Amount (KES)<input name="amount" type="number" min="0.01" max="10000000" step="0.01" inputMode="decimal" required /></label>
                  <label>Payment method<select name="method" defaultValue="cash"><option value="cash">Cash</option><option value="mpesa_manual">M-Pesa (recorded manually)</option><option value="other">Other</option></select></label>
                  <label>Receipt / reference (optional)<input name="reference" maxLength="80" /></label>
                  <label>Payment date<input name="date" type="date" max={today()} defaultValue={today()} required /></label>
                  <label>Note (optional)<textarea name="note" maxLength="500" rows="3" /></label>
                  <button className="auth-submit pilot-submit" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Record payment'}<span aria-hidden="true">→</span></button>
                </form> : <p>Only a school administrator or bursar can record fee payments.</p>}
              </section>
              <section className="pilot-card pilot-card-wide" aria-labelledby="payments-title">
                <p className="eyebrow">SCHOOL PAYMENT HISTORY</p>
                <h3 id="payments-title">Recent payments</h3>
                {payments.length ? <div className="pilot-table-wrap"><table className="pilot-table"><thead><tr><th>Date</th><th>Student</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id}><td>{String(payment.date).slice(0, 10)}</td><td>{payment.studentName}</td><td>KES {Number(payment.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td>{payment.method === 'mpesa_manual' ? 'M-Pesa · manual' : payment.method}</td><td>{payment.reference || '—'}</td></tr>)}</tbody></table></div> : <p className="pilot-empty">No fee payments have been recorded yet.</p>}
                <p className="pilot-small">This register does not initiate or verify M-Pesa transactions. Reconcile recorded payments against the official receipt.</p>
              </section>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default SchoolPilot;
