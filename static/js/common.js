/*
 * Copyright Adam Pritchard 2014
 * MIT License : http://adampritchard.mit-license.org/
 */

/* jshint sub:true */

(function( DECA, $, _, undefined ) {
  "use strict";

  var _this = DECA;

  // This is repeated in config/__init__.py
  _this.MULTIVALUE_DIVIDER = '; ';

  //
  // Fancy checkbox functions
  //

  function initializeCheckboxes() {
    var checkBoxIcon = function(icon, check) {
      var checkedIcon = $(icon).data('checked-icon');
      var uncheckedIcon = $(icon).data('unchecked-icon');

      if (check) {
        $(icon).removeClass(uncheckedIcon)
               .addClass(checkedIcon);
      }
      else {
        $(icon).removeClass(checkedIcon)
               .addClass(uncheckedIcon);
      }
    };

    var updateCheckgroup = function(checkgroup) {
      if (!checkgroup) {
        checkgroup = this;
      }

      var checked = $(checkgroup).find('input[type="checkbox"]').prop('checked');
      checkBoxIcon($(checkgroup).find('i'), checked);
    };

    var updateAllCheckgroups = function() {
      $('.checkbox-group').each(updateCheckgroup);
    };

    updateAllCheckgroups();

    var checkboxGroupClicked = function() {
      var checked = $(this).find('input[type="checkbox"]').prop('checked');
      $(this).find('input[type="checkbox"]').prop('checked', checked ? '' : 'checked');
      updateCheckgroup(this);
    };

    $('.checkbox-group').click(checkboxGroupClicked);

    var checkboxChanged = function() {
      updateCheckgroup($(this).parent('.checkbox-group'));
    };

    $('.checkbox-group input[type="checkbox"]').change(checkboxChanged);

    // Our "checkbox plus text" inputs aren't really checkboxes at all --
    // they're just text boxes with a checkbox-ish icon indicating whether the
    // value should be used.
    var checkboxTextChanged = function() {
      var check = !!$(this).val();
      checkBoxIcon($(this).parent().find('i'), check);
    };

    $('.checkbox-text input').change(checkboxTextChanged)
                             .keyup(checkboxTextChanged);

    var focusToText = function() {
      $(this).parent().find('input').focus();
    };

    $('.checkbox-text .input-group-addon').click(focusToText);
  }


  //
  // Member form functions
  //

  var _geoposition = null;

  // Public method
  _this.setupMemberFormSubmit = function(form_mode, // 'create', 'renew', 'self-serve'
                                         form,
                                         modal,
                                         submit) {
    var curriedOnSubmitMember = _.curry(onSubmitMember)(form_mode, $(form), $(modal));

    $(form).bootstrapValidator();
    $(submit).click(curriedOnSubmitMember);

    // Force the postal code to uppercase
    $(form).find('[data-bv-zipcode]').keyup(function() {
      var val = $(this).val();
      if (val) {
        $(this).val(val.toUpperCase());
      }
    });

    _this.setupWaitModal($(modal), curriedOnSubmitMember);

    if (form_mode !== 'self-serve' && // if we're not 'self-serve' mode...
        Modernizr.geolocation) {      // and the geolocation service is available...
      // ...get our location.
      navigator.geolocation.getCurrentPosition(
        function(result) {
          // Only record the geo data if it's reasonably accurate.
          if (result.coords.accuracy <= 1000) {
            _geoposition = result;
          }
        },
        function() {
          console.log('geolocation fail', arguments);
        },
        {
          enableHighAccuracy: true,
          timeout: 30 * 1000,
          maximumAge: 5 * 60 * 1000 // 5 mins
        });
    }
  };

  // Public method
  _this.setupVolunteerFormSubmit = function(form_mode, // 'create', 'renew', 'self-serve'
                                            form,
                                            modal,
                                            submit) {
    // Some day there might be special/different processing, but for now...
    _this.setupMemberFormSubmit(form_mode, form, modal, submit);
  };

  function onSubmitMember(form_mode, $form, $modal, event) {
    if (event) {
      event.preventDefault();
    }

    $form.data('bootstrapValidator').validate();
    if (!$form.data('bootstrapValidator').isValid()) {
      var $badElems = $form.find('.has-error');
      $badElems.eq(0).find('input').focus();
      $('html, body').animate({
        scrollTop: $badElems.eq(0).offset().top
      });
      $badElems.addClass('bg-danger', 1000, function() {
        $(this).removeClass('bg-danger', 3000);
      });
      return false;
    }

    // Do a little extra work to format the postal code
    $form.find('[data-bv-zipcode]').each(function() {
      var val = $(this).val();
      if (val) {
        val = val.toUpperCase().replace(/(\w{3})(\w{3})/, '$1 $2');
        $(this).val(val);
      }
    });

    var data = $form.serializeObject();

    // Add geoposition if available
    if (_geoposition) {
      // TODO: Don't hardcode field names

      data['geoposition'] = '' + _geoposition.coords.latitude + ', ' +
                                 _geoposition.coords.longitude;
    }

    data = cleanMemberFormData(data);
    console.log(data);

    // When we POST this data, the 'Referer' will be our own URL. If we're in
    // an iframe we also want to know the parent URL, so we'll include that in
    // the data.
    if (window !== window.top) {
      // TODO: don't hardcode the key
      data['_referrer'] = document.referrer;
    }

    _this.waitModalShow($modal);

    var jqxhr = $.post($form.attr('action'), data)
        .done(function() {
          console.log('success', arguments);
          _this.waitModalSuccess($modal);

          if (form_mode === 'self-serve' && jqxhr.responseText !== 'success') {
            // The server gave us a Paypal URL to go to. Redirect there.
            // TODO: move this into self-serve-join.js
            $modal.find('.waitModalRedirectLink').prop('href', jqxhr.responseText);
            window.top.location = jqxhr.responseText;
          }
        })
        .fail(function() {
          console.log('fail', arguments);
          var retry, conflict_email;

          // Some errors we handle specially...
          if (jqxhr.status >= 500 && jqxhr.status < 600) {
            // Retry on server errors.
            retry = true;
          }
          else if (form_mode == 'create' && jqxhr.status == 409) {
            // User tried to create a member with the same email address as
            // an already existing member. We'll guide the user toward the
            // renew page.
            // TODO: don't hardcode this field name
            conflict_email = data['email'];
          }

          _this.waitModalError($modal, jqxhr.statusText, jqxhr.responseText,
                               retry, conflict_email);
        });
    console.log('jqxhr', jqxhr);

    return false;
  }

  function cleanMemberFormData(data) {
    // We're actually going to alter the input, but that's okay.
    _.forOwn(data, function(val, key) {
      if (_(val).isArray()) {
        data[key] = _.compact(val).join(_this.MULTIVALUE_DIVIDER);
      }
    });

    return data;
  }


  //
  // Wait modal functions
  //

  _this.setupWaitModal = function($modal, resubmitFn) {
    $modal.find('.waitModalRetry').click(function(event) {
      _this.waitModalReset($modal);
      return resubmitFn(event);
    });
  };

  _this.waitModalShow = function($modal) {
    _this.waitModalReset($modal);
    $modal.modal();
  };

  _this.waitModalSuccess = function($modal) {
    $modal.find('.success-show').removeClass('hidden');
    $modal.find('.success-hide').addClass('hidden');
  };

  _this.waitModalError = function($modal, statusText, responseText,
                                  retry, conflict_email) {
    $modal.find('.error-show').removeClass('hidden');
    $modal.find('.error-hide').addClass('hidden');

    if (conflict_email) {
      var href = $modal.find('.waitModalRenew').attr('href');
      $modal.find('.waitModalRenew').data('original-href', href);
      href += '#' + encodeURIComponent(conflict_email);
      $modal.find('.waitModalRenew').prop('href', href);

      $modal.find('.conflict-email-show').removeClass('hidden');
      $modal.find('.conflict-email-hide').addClass('hidden');
    }
    else {
      $modal.find('.waitModalServerMessage').text(statusText + ': ' + responseText);

      if (retry) {
        $modal.find('.retry-show').removeClass('hidden');
        $modal.find('.retry-hide').addClass('hidden');
      }
      else {
        $modal.find('.retry-show').addClass('hidden');
        $modal.find('.retry-hide').removeClass('hidden');
      }
    }
  };

  _this.waitModalReset = function($modal) {
    $modal.find('.reset-hide').addClass('hidden');
    $modal.find('.reset-show').removeClass('hidden');

    $modal.find('.waitModalRenew').prop('href',
      $modal.find('.waitModalRenew').data('original-href'));
    $modal.find('.waitModalServerMessage').text('');
  };


  //
  // General initialization
  //

  function startup() {
    initializeCheckboxes();
  }

  $(startup);

}( window.DECA = window.DECA || {}, jQuery, _ ));
