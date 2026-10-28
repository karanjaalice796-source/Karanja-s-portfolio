const crypto = require('node:crypto');

const templates = {
  wedding: {
    label: 'Wedding',
    vendors: [
      ['Planner', 'Planning'],
      ['Caterer', 'Catering'],
      ['Decorator', 'Decoration'],
    ],
    tasks: [
      ['Vendor setup', '09:00'],
      ['Ceremony', '12:00'],
      ['Dinner service', '16:00'],
      ['Reception begins', '18:00'],
    ],
  },
  birthday: {
    label: 'Birthday',
    vendors: [
      ['Cake baker', 'Cakes'],
      ['DJ', 'Entertainment'],
      ['Decorator', 'Decoration'],
    ],
  },
  graduation: {
    label: 'Graduation',
    vendors: [
      ['Photographer', 'Photography'],
      ['Caterer', 'Catering'],
      ['Venue', 'Venue'],
    ],
  },
  corporate: {
    label: 'Corporate',
    vendors: [
      ['Venue', 'Venue'],
      ['AV provider', 'Audio-visual'],
      ['Caterer', 'Catering'],
    ],
    tasks: [
      ['Venue and AV setup', '08:00'],
      ['Guest registration', '09:00'],
      ['Opening remarks', '10:00'],
      ['Lunch service', '12:30'],
    ],
  },
  'baby-family': {
    label: 'Baby and family',
    vendors: [
      ['Decorator', 'Decoration'],
      ['Cake baker', 'Cakes'],
      ['Photographer', 'Photography'],
    ],
  },
  religious: {
    label: 'Religious',
    vendors: [
      ['Tent supplier', 'Equipment rental'],
      ['Chair supplier', 'Equipment rental'],
      ['Sound system provider', 'Audio-visual'],
    ],
  },
  entertainment: {
    label: 'Entertainment',
    vendors: [
      ['DJ', 'Entertainment'],
      ['Stage provider', 'Stage and lighting'],
      ['Security team', 'Security'],
    ],
  },
  education: {
    label: 'Education',
    vendors: [
      ['Caterer', 'Catering'],
      ['Printer', 'Printing'],
      ['Photographer', 'Photography'],
    ],
  },
  sports: {
    label: 'Sports',
    vendors: [
      ['Equipment supplier', 'Equipment'],
      ['Medical team', 'Medical'],
    ],
  },
  'private-gathering': {
    label: 'Private gathering',
    vendors: [
      ['Private chef', 'Catering'],
      ['Decorator', 'Decoration'],
      ['Photographer', 'Photography'],
    ],
  },
  community: {
    label: 'Community',
    vendors: [
      ['Organizer', 'Organization'],
      ['Transport provider', 'Transport'],
      ['Equipment supplier', 'Equipment'],
    ],
  },
  'business-promotion': {
    label: 'Business promotion',
    vendors: [
      ['Branding company', 'Branding'],
      ['Planner', 'Planning'],
      ['MC', 'Entertainment'],
    ],
  },
};

function isTemplateName(name) {
  return Object.prototype.hasOwnProperty.call(templates, name);
}

function isEventType(name) {
  return name === 'other' || isTemplateName(name);
}

function eventTypeLabel(name) {
  return templates[name]?.label || 'Other';
}

function createTemplateEntries(db, eventId, eventDate, templateName) {
  if (!isTemplateName(templateName)) return;
  const template = templates[templateName];
  const insertVendor = db.prepare(
    'INSERT INTO vendors (event_id, name, category, email, token) VALUES (?, ?, ?, ?, ?)',
  );
  const insertTask = db.prepare(
    'INSERT INTO tasks (event_id, vendor_id, title, start_time, notes) VALUES (?, ?, ?, ?, ?)',
  );
  const vendorIds = [];
  for (const [name, category] of template.vendors) {
    const result = insertVendor.run(eventId, name, category, '', crypto.randomBytes(32).toString('hex'));
    vendorIds.push(Number(result.lastInsertRowid));
  }
  if (template.tasks) {
    for (const [title, time] of template.tasks) {
      insertTask.run(eventId, null, title, `${eventDate}T${time}`, '');
    }
    return;
  }
  for (const vendorId of vendorIds) {
    insertTask.run(eventId, vendorId, 'Vendor arrival and setup', `${eventDate}T09:00`, '');
  }
  insertTask.run(eventId, null, 'Event begins', `${eventDate}T12:00`, '');
  insertTask.run(eventId, null, 'Event ends', `${eventDate}T17:00`, '');
}

module.exports = { templates, isTemplateName, isEventType, eventTypeLabel, createTemplateEntries };
