(function () {
  var form = document.querySelector('.client-request-form[data-event-request-form]');
  if (!form) return;
  var category = form.querySelector('[data-event-category]');
  var hint = form.querySelector('[data-category-hint]');
  var specificFields = form.querySelectorAll('[data-client-specific]');
  var prompts = {
    wedding: 'Wedding planning: ceremony and reception style, bridal party needs, catering preferences and guest experience.',
    'business-promotion': 'Business promotion: campaign goals, target audience, brand assets, product demonstrations and marketing channels.',
    corporate: 'Business event: agenda, audience, presentation needs, branding, catering and accessibility.',
    graduation: 'Graduation: school or institution details, ceremony format, stage setup, certificates and guest arrangements.',
    birthday: 'Birthday: age group, theme, activities, catering and entertainment preferences.',
    'baby-family': 'Family celebration: preferred traditions, guest arrangements, catering and accessibility needs.',
    religious: 'Religious event: service format, community requirements, venue arrangements and sound needs.',
    other: 'Add any category-specific arrangements or requirements for your event.',
  };

  function updateCategory() {
    if (hint) hint.textContent = prompts[category.value] || prompts.other;
    specificFields.forEach(function (field) {
      var isSelected = field.getAttribute('data-client-specific') === category.value;
      field.hidden = !isSelected;
      field.querySelectorAll('input, textarea, select').forEach(function (input) {
        input.disabled = !isSelected;
        input.required = isSelected && input.hasAttribute('data-required');
      });
    });
  }

  category.addEventListener('change', updateCategory);
  updateCategory();
})();
