var noop = require("../../core/utils/common").noop,
    typeUtils = require("../../core/utils/type"),
    extend = require("../../core/utils/extend").extend,
    BaseThemeManager = require("../core/base_theme_manager").BaseThemeManager,
    _isString = typeUtils.isString,
    _isDefined = typeUtils.isDefined,
    _normalizeEnum = require("../core/utils").normalizeEnum,

    FONT = "font",
    COMMON_AXIS_SETTINGS = "commonAxisSettings",

    PIE_FONT_FIELDS = ["legend." + FONT, "title." + FONT, "title.subtitle." + FONT, "tooltip." + FONT, "loadingIndicator." + FONT, "export." + FONT, "commonSeriesSettings.label." + FONT],
    POLAR_FONT_FIELDS = PIE_FONT_FIELDS.concat([COMMON_AXIS_SETTINGS + ".label." + FONT, COMMON_AXIS_SETTINGS + ".title." + FONT]),
    CHART_FONT_FIELDS = POLAR_FONT_FIELDS.concat(["crosshair.label." + FONT]),

    chartToFontFieldsMap = {
        pie: PIE_FONT_FIELDS,
        chart: CHART_FONT_FIELDS,
        polar: POLAR_FONT_FIELDS
    };

var ThemeManager = BaseThemeManager.inherit((function() {
    var ctor = function(options, themeGroupName) {
        var that = this;

        that.callBase.apply(that, arguments);

        options = options || {};
        that._userOptions = options;
        that._mergeAxisTitleOptions = [];
        that._multiPieColors = {};
        that._themeSection = themeGroupName;

        that._fontFields = chartToFontFieldsMap[themeGroupName];

        // This is required because chart calls "_getOption" during "_init" stage
        // TODO: Remove it when chart stops doing that
        that._callback = noop;
    };

    var dispose = function() {
        var that = this;
        that.palette && that.palette.dispose();
        that.palette = that._userOptions = that._mergedSettings = that._multiPieColors = null;
        return that.callBase.apply(that, arguments);
    };

    var resetPalette = function() {
        this.palette.reset();
        this._multiPieColors = {};
    };

    var processTitleOptions = function(options) {
        return _isString(options) ? { text: options } : options;
    };

    var processAxisOptions = function(axisOptions) {
        if(!axisOptions) {
            return {};
        }
        axisOptions = extend(true, {}, axisOptions);
        axisOptions.title = processTitleOptions(axisOptions.title);

        if(axisOptions.type === "logarithmic" && (axisOptions.logarithmBase <= 0) || (axisOptions.logarithmBase && !typeUtils.isNumeric(axisOptions.logarithmBase))) {
            axisOptions.logarithmBase = undefined;
            axisOptions.logarithmBaseError = true;
        }
        if(axisOptions.label) {
            if(axisOptions.label.alignment) {
                axisOptions.label["userAlignment"] = true;
            }
        }
        return axisOptions;
    };

    var applyParticularAxisOptions = function(name, userOptions, rotated) {
        var theme = this._theme,
            position = !(rotated ^ (name === "valueAxis")) ? "horizontalAxis" : "verticalAxis",
            processedUserOptions = processAxisOptions(userOptions, name),
            commonAxisSettings = processAxisOptions(this._userOptions["commonAxisSettings"], name),
            mergeOptions = extend(true, {}, theme.commonAxisSettings, theme[position], theme[name], commonAxisSettings, processedUserOptions);

        mergeOptions.workWeek = processedUserOptions.workWeek || theme[name].workWeek;
        return mergeOptions;
    };

    var mergeOptions = function(name, userOptions) {
        userOptions = userOptions || this._userOptions[name];
        var theme = this._theme[name],
            result = this._mergedSettings[name];
        if(result) { return result; }
        if(typeUtils.isPlainObject(theme) && typeUtils.isPlainObject(userOptions)) {
            result = extend(true, {}, theme, userOptions);
        } else {
            result = _isDefined(userOptions) ? userOptions : theme;
        }
        this._mergedSettings[name] = result;
        return result;
    };


    var applyParticularTheme = {
        base: mergeOptions,
        argumentAxis: applyParticularAxisOptions,
        valueAxisRangeSelector: function() {
            return mergeOptions.call(this, "valueAxis");
        },
        valueAxis: applyParticularAxisOptions,
        series: function(name, userOptions, seriesCount) {
            var that = this,
                theme = that._theme,
                userCommonSettings = that._userOptions.commonSeriesSettings || {},
                themeCommonSettings = theme.commonSeriesSettings,
                widgetType = that._themeSection.split(".").slice(-1)[0],
                type = _normalizeEnum(userOptions.type || userCommonSettings.type || themeCommonSettings.type || (widgetType === "pie" && theme.type)), // userCommonSettings.type && themeCommonSettings.type deprecated in 15.2 in pie
                settings,
                palette = that.palette,
                isBar = ~type.indexOf("bar"),
                isLine = ~type.indexOf("line"),
                isArea = ~type.indexOf("area"),
                isBubble = type === "bubble",
                mainSeriesColor,
                resolveLabelsOverlapping = that.getOptions("resolveLabelsOverlapping"),
                containerBackgroundColor = that.getOptions("containerBackgroundColor"),
                seriesTemplate = applyParticularTheme.seriesTemplate.call(this),
                seriesVisibility;

            if(isBar || isBubble) {
                userOptions = extend(true, {}, userCommonSettings, userCommonSettings[type], userOptions);
                seriesVisibility = userOptions.visible;
                userCommonSettings = { type: {} };
                extend(true, userOptions, userOptions.point);
                userOptions.visible = seriesVisibility;
            }

            settings = extend(true, { aggregation: {} }, themeCommonSettings, themeCommonSettings[type], userCommonSettings, userCommonSettings[type], userOptions);

            settings.aggregation.enabled = widgetType === "chart" && normalizeAggregationEnabled(settings.aggregation, that.getOptions("useAggregation"));
            settings.type = type;
            settings.widgetType = widgetType;
            settings.containerBackgroundColor = containerBackgroundColor;

            if(widgetType !== "pie") {
                mainSeriesColor = settings.color || palette.getNextColor(seriesCount);
            } else {

                mainSeriesColor = function(argument, index, count) {
                    const cat = `${argument}-${index}`;

                    if(!that._multiPieColors[cat]) {
                        that._multiPieColors[cat] = palette.getNextColor(count);
                    }
                    return that._multiPieColors[cat];
                };
            }
            settings.mainSeriesColor = mainSeriesColor;
            settings.resolveLabelsOverlapping = resolveLabelsOverlapping;

            if(settings.label && (isLine || (isArea && type !== "rangearea") || type === "scatter")) {
                settings.label.position = "outside";
            }

            if(seriesTemplate) {
                settings.nameField = seriesTemplate.nameField;
            }

            return settings;
        },
        animation: function(name) {
            var userOptions = this._userOptions[name];
            userOptions = typeUtils.isPlainObject(userOptions) ? userOptions : _isDefined(userOptions) ? { enabled: !!userOptions } : {};
            return mergeOptions.call(this, name, userOptions);
        },
        seriesTemplate() {
            const value = mergeOptions.call(this, "seriesTemplate");
            if(value) {
                value.nameField = value.nameField || "series";
            }
            return value;
        }
    };

    var normalizeAggregationEnabled = function(aggregation, useAggregation) {
        return !!(!_isDefined(aggregation.enabled) ? useAggregation : aggregation.enabled);
    };

    return {
        _themeSection: "chart",
        ctor: ctor,
        dispose: dispose,
        resetPalette: resetPalette,
        getOptions: function(name) {
            return (applyParticularTheme[name] || applyParticularTheme.base).apply(this, arguments);
        },
        refresh: function() {
            this._mergedSettings = {};
            return this.callBase.apply(this, arguments);
        },
        _initializeTheme: function() {
            var that = this;
            that.callBase.apply(that, arguments);
            that.updatePalette();
        },
        resetOptions: function(name) {
            this._mergedSettings[name] = null;
        },
        update: function(options) {
            this._userOptions = options;
        },
        updatePalette: function() {
            var that = this;
            that.palette = that.createPalette(that.getOptions("palette"), {
                useHighlight: true,
                extensionMode: that.getOptions("paletteExtensionMode")
            });
        }
    };
})());

exports.ThemeManager = ThemeManager;
