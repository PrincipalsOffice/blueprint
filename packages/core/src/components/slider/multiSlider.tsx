/*
 * Copyright 2018 Palantir Technologies, Inc. All rights reserved.
 *
 * Licensed under the terms of the LICENSE file distributed with this project.
 */

import classNames from "classnames";
import * as React from "react";

import { Classes, Intent } from "../../common";
import { AbstractPureComponent } from "../../common/abstractPureComponent";
import { intentClass } from "../../common/classes";
import * as Errors from "../../common/errors";
import { IProps } from "../../common/props";
import * as Utils from "../../common/utils";
import { Handle } from "./handle";
import { ISliderHandleProps, SliderHandle, SliderHandleInteractionKind, SliderHandleType } from "./sliderHandle";
import { SliderTrackStop } from "./sliderTrackStop";

export interface ICoreSliderProps extends IProps {
    /**
     * Whether the slider is non-interactive.
     * @default false
     */
    disabled?: boolean;

    /**
     * Increment between successive labels. Must be greater than zero.
     * @default 1
     */
    labelStepSize?: number;

    /**
     * Number of decimal places to use when rendering label value. Default value is the number of
     * decimals used in the `stepSize` prop. This prop has _no effect_ if you supply a custom
     * `labelRenderer` callback.
     * @default inferred from stepSize
     */
    labelPrecision?: number;

    /**
     * Maximum value of the slider.
     * @default 10
     */
    max?: number;

    /**
     * Minimum value of the slider.
     * @default 0
     */
    min?: number;

    /**
     * Whether a solid bar should be rendered on the track between current and initial values,
     * or between handles for `RangeSlider`.
     * @default true
     */
    showTrackFill?: boolean;

    /**
     * Increment between successive values; amount by which the handle moves. Must be greater than zero.
     * @default 1
     */
    stepSize?: number;

    /**
     * Callback to render a single label. Useful for formatting numbers as currency or percentages.
     * If `true`, labels will use number value formatted to `labelPrecision` decimal places.
     * If `false`, labels will not be shown.
     * @default true
     */
    labelRenderer?: boolean | ((value: number) => string | JSX.Element);

    /**
     * Whether to show the slider in a vertical orientation.
     * @default false
     */
    vertical?: boolean;
}

export interface IMultiSliderProps extends ICoreSliderProps {
    children?: React.ReactNode;
    defaultTrackIntent?: Intent;
    onChange?(values: number[]): void;
    onRelease?(values: number[]): void;
}

export interface ISliderState {
    labelPrecision?: number;
    /** the client size, in pixels, of one tick */
    tickSize?: number;
    /** the size of one tick as a ratio of the component's client size */
    tickSizeRatio?: number;
}

export class MultiSlider extends AbstractPureComponent<IMultiSliderProps, ISliderState> {
    public static defaultCoreProps: ICoreSliderProps = {
        disabled: false,
        labelStepSize: 1,
        max: 10,
        min: 0,
        showTrackFill: true,
        stepSize: 1,
        vertical: false,
    };

    public static defaultProps: IMultiSliderProps = {
        ...MultiSlider.defaultCoreProps,
        defaultTrackIntent: Intent.NONE,
    };

    public static displayName = "Blueprint2.MultiSlider";
    public className = classNames(Classes.SLIDER, Classes.MULTI_SLIDER);

    private handles: Handle[] = [];
    private sortedHandleProps: ISliderHandleProps[];

    private trackElement: HTMLElement;
    private refHandlers = {
        track: (el: HTMLDivElement) => (this.trackElement = el),
    };

    public constructor(props: IMultiSliderProps) {
        super(props);
        this.state = {
            labelPrecision: this.getLabelPrecision(props),
            tickSize: 0,
            tickSizeRatio: 0,
        };
    }

    public render() {
        const classes = classNames(
            this.className,
            {
                [Classes.DISABLED]: this.props.disabled,
                [`${Classes.SLIDER}-unlabeled`]: this.props.labelRenderer === false,
                [Classes.VERTICAL]: this.props.vertical,
            },
            this.props.className,
        );
        return (
            <div className={classes} onMouseDown={this.maybeHandleTrackClick} onTouchStart={this.maybeHandleTrackTouch}>
                <div className={Classes.SLIDER_TRACK} ref={this.refHandlers.track} />
                {this.maybeRenderFill()}
                {this.maybeRenderAxis()}
                {this.renderHandles()}
            </div>
        );
    }

    public componentWillMount() {
        this.sortedHandleProps = getSortedHandleProps(this.props);
    }

    public componentDidMount() {
        this.updateTickSize();
    }

    public componentDidUpdate() {
        this.updateTickSize();
    }

    public componentWillReceiveProps(nextProps: IMultiSliderProps) {
        this.setState({ labelPrecision: this.getLabelPrecision(nextProps) });

        const newSortedHandleProps = getSortedHandleProps(nextProps);
        if (newSortedHandleProps.length !== this.sortedHandleProps.length) {
            this.handles = [];
        }
        this.sortedHandleProps = newSortedHandleProps;
    }

    protected validateProps(props: IMultiSliderProps) {
        if (props.stepSize <= 0) {
            throw new Error(Errors.SLIDER_ZERO_STEP);
        }
        if (props.labelStepSize <= 0) {
            throw new Error(Errors.SLIDER_ZERO_LABEL_STEP);
        }

        let anyInvalidChildren = false;
        React.Children.forEach(props.children, child => {
            if (
                child != null &&
                !Utils.isElementOfType(child, SliderHandle) &&
                !Utils.isElementOfType(child, SliderTrackStop)
            ) {
                anyInvalidChildren = true;
            }
        });
        if (anyInvalidChildren) {
            throw new Error(Errors.MULTISLIDER_INVALID_CHILD);
        }
    }

    private formatLabel(value: number): React.ReactChild {
        const { labelRenderer } = this.props;
        if (labelRenderer === false) {
            return undefined;
        } else if (Utils.isFunction(labelRenderer)) {
            // TODO: TS 2.7 might have a type narrowing issue?
            return (labelRenderer as (value: number) => React.ReactChild)(value);
        } else {
            return value.toFixed(this.state.labelPrecision);
        }
    }

    private maybeRenderAxis() {
        // explicit typedefs are required because tsc (rightly) assumes that props might be overriden with different
        // types in subclasses
        const max: number = this.props.max;
        const min: number = this.props.min;
        const labelStepSize: number = this.props.labelStepSize;
        if (this.props.labelRenderer === false) {
            return undefined;
        }

        const stepSizeRatio = this.state.tickSizeRatio * labelStepSize;
        const labels: JSX.Element[] = [];
        // tslint:disable-next-line:one-variable-per-declaration ban-comma-operator
        for (
            let i = min, offsetRatio = 0;
            i < max || Utils.approxEqual(i, max);
            i += labelStepSize, offsetRatio += stepSizeRatio
        ) {
            const offsetPercentage = formatPercentage(offsetRatio);
            const style = this.props.vertical ? { bottom: offsetPercentage } : { left: offsetPercentage };
            labels.push(
                <div className={`${Classes.SLIDER}-label`} key={i} style={style}>
                    {this.formatLabel(i)}
                </div>,
            );
        }
        return <div className={`${Classes.SLIDER}-axis`}>{labels}</div>;
    }
    private maybeRenderFill() {
        if (this.trackElement == null) {
            return undefined;
        }

        const trackStops = [...this.sortedHandleProps, ...this.getTrackStops()];
        trackStops.sort((left, right) => left.value - right.value);
        if (trackStops.length === 0 || trackStops[0].value > this.props.min) {
            trackStops.unshift({ value: this.props.min });
        }
        if (trackStops[trackStops.length - 1].value < this.props.max) {
            trackStops.push({ value: this.props.max });
        }

        const tracks: Array<JSX.Element | null> = [];

        for (let index = 0; index < trackStops.length - 1; index++) {
            const left = trackStops[index];
            const right = trackStops[index + 1];
            const fillIntentPriorities = [
                this.props.showTrackFill ? undefined : Intent.NONE,
                left.trackIntentAfter,
                right.trackIntentBefore,
                this.props.defaultTrackIntent,
            ];
            const fillIntent = fillIntentPriorities.filter(intent => intent != null)[0];
            tracks.push(this.renderTrackFill(index, left, right, fillIntent));
        }

        return <div className={Classes.SLIDER_TRACK}>{tracks}</div>;
    }

    private getTrackStops(): ISliderHandleProps[] {
        const maybeStops = React.Children.map(
            this.props.children,
            child => (Utils.isElementOfType(child, SliderTrackStop) ? child.props : null),
        );
        return maybeStops != null ? maybeStops : [];
    }

    private renderTrackFill(index: number, start: ISliderHandleProps, end: ISliderHandleProps, intent: Intent) {
        const { tickSizeRatio } = this.state;
        const startValue = start.value;
        const endValue = end.value;

        let startOffsetRatio = this.getOffsetRatio(startValue, tickSizeRatio);
        let endOffsetRatio = this.getOffsetRatio(endValue, tickSizeRatio);

        if (startOffsetRatio > endOffsetRatio) {
            const temp = endOffsetRatio;
            endOffsetRatio = startOffsetRatio;
            startOffsetRatio = temp;
        }

        const startOffset = formatPercentage(startOffsetRatio);
        const endOffset = formatPercentage(1 - endOffsetRatio);

        const style: React.CSSProperties = this.props.vertical
            ? { bottom: startOffset, top: endOffset, left: 0 }
            : { left: startOffset, right: endOffset, top: 0 };

        const classes = classNames(Classes.SLIDER_PROGRESS, intentClass(intent), {
            [Classes.START]: start.type === SliderHandleType.START,
            [Classes.END]: end.type === SliderHandleType.END,
            [`${Classes.SLIDER_PROGRESS}-empty`]: intent === Intent.NONE,
        });

        return <div key={`track-${index}`} className={classes} style={style} />;
    }

    private getOffsetRatio(value: number, tickSizeRatio: number) {
        return Utils.clamp((value - this.props.min) * tickSizeRatio, 0, 1);
    }

    private renderHandles() {
        const { disabled, max, min, stepSize, vertical } = this.props;
        return this.sortedHandleProps.map(({ value, type }, index) => (
            <Handle
                className={classNames({
                    [Classes.START]: type === SliderHandleType.START,
                    [Classes.END]: type === SliderHandleType.END,
                })}
                disabled={disabled}
                key={`${index}-${this.sortedHandleProps.length}`}
                label={this.formatLabel(value)}
                max={max}
                min={min}
                onChange={this.getHandlerForIndex(index, this.handleChange)}
                onRelease={this.getHandlerForIndex(index, this.props.onRelease)}
                ref={this.addHandleRef}
                stepSize={stepSize}
                tickSize={this.state.tickSize}
                tickSizeRatio={this.state.tickSizeRatio}
                value={value}
                vertical={vertical}
            />
        ));
    }

    private addHandleRef = (ref: Handle) => {
        if (ref != null) {
            this.handles.push(ref);
        }
    };

    private maybeHandleTrackClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (this.canHandleTrackEvent(event)) {
            const foundHandle = this.nearestHandleForValue(this.handles, handle =>
                handle.mouseEventClientOffset(event),
            );
            if (foundHandle) {
                foundHandle.beginHandleMovement(event);
            }
        }
    };

    private maybeHandleTrackTouch = (event: React.TouchEvent<HTMLDivElement>) => {
        if (this.canHandleTrackEvent(event)) {
            const foundHandle = this.nearestHandleForValue(this.handles, handle =>
                handle.touchEventClientOffset(event),
            );
            if (foundHandle) {
                foundHandle.beginHandleTouchMovement(event);
            }
        }
    };

    private canHandleTrackEvent = (event: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement;
        // ensure event does not come from inside the handle
        return !this.props.disabled && target.closest(`.${Classes.SLIDER_HANDLE}`) == null;
    };

    private nearestHandleForValue(handles: Handle[], getOffset: (handle: Handle) => number): Handle | undefined {
        return argMin(handles, handle => {
            const offset = getOffset(handle);
            const offsetValue = handle.clientToValue(offset);
            const handleValue = handle.props.value!;
            return Math.abs(offsetValue - handleValue);
        });
    }

    private getHandlerForIndex = (index: number, callback?: (values: number[]) => void) => {
        return (newValue: number) => {
            Utils.safeInvoke(callback, this.getNewHandleValues(newValue, index));
        };
    };

    private getNewHandleValues(newValue: number, oldIndex: number) {
        const oldValues = this.sortedHandleProps.map(handle => handle.value);
        const start = oldValues.slice(0, oldIndex);
        const end = oldValues.slice(oldIndex + 1);
        const newValues = [...start, newValue, ...end];
        newValues.sort((left, right) => left - right);

        const newIndex = newValues.indexOf(newValue);
        const lockIndex = this.findFirstLockedHandleIndex(oldIndex, newIndex);
        if (lockIndex === undefined) {
            fillValues(newValues, oldIndex, newIndex, newValue);
        } else {
            // If pushing past a locked handle, discard the new value and only make the updates to clamp values against the lock.
            const lockValue = oldValues[lockIndex];
            fillValues(oldValues, oldIndex, lockIndex, lockValue);
            return oldValues;
        }

        return newValues;
    }

    private findFirstLockedHandleIndex(startIndex: number, endIndex: number): number | undefined {
        const inc = startIndex < endIndex ? 1 : -1;
        for (let index = startIndex + inc; index !== endIndex + inc; index += inc) {
            if (this.sortedHandleProps[index].interactionKind !== SliderHandleInteractionKind.PUSH) {
                return index;
            }
        }
        return undefined;
    }

    private handleChange = (newValues: number[]) => {
        const oldValues = this.sortedHandleProps.map(handle => handle.value);
        if (!Utils.arraysEqual(newValues, oldValues)) {
            Utils.safeInvoke(this.props.onChange, newValues);
        }
    };

    private getLabelPrecision({ labelPrecision, stepSize }: IMultiSliderProps) {
        // infer default label precision from stepSize because that's how much the handle moves.
        return labelPrecision == null ? Utils.countDecimalPlaces(stepSize) : labelPrecision;
    }

    private updateTickSize() {
        if (this.trackElement != null) {
            const trackSize = this.props.vertical ? this.trackElement.clientHeight : this.trackElement.clientWidth;
            const tickSizeRatio = 1 / ((this.props.max as number) - (this.props.min as number));
            const tickSize = trackSize * tickSizeRatio;
            this.setState({ tickSize, tickSizeRatio });
        }
    }
}

/** Helper function for formatting ratios as CSS percentage values. */
export function formatPercentage(ratio: number) {
    return `${(ratio * 100).toFixed(2)}%`;
}

function getSortedHandleProps({ children }: IMultiSliderProps): ISliderHandleProps[] {
    const maybeHandles = React.Children.map(
        children,
        child => (Utils.isElementOfType(child, SliderHandle) ? child.props : null),
    );
    let handles = maybeHandles != null ? maybeHandles : [];
    handles = handles.filter(handle => handle !== null);
    handles.sort((left, right) => left.value - right.value);
    return handles;
}

function fillValues(values: number[], startIndex: number, endIndex: number, fillValue: number) {
    const inc = startIndex < endIndex ? 1 : -1;
    for (let index = startIndex; index !== endIndex + inc; index += inc) {
        values[index] = fillValue;
    }
}

function argMin<T>(values: T[], argFn: (value: T) => any): T | undefined {
    if (values.length === 0) {
        return undefined;
    }

    let minValue = values[0];
    let minArg = argFn(minValue);

    for (let index = 1; index < values.length; index++) {
        const value = values[index];
        const arg = argFn(value);
        if (arg < minArg) {
            minValue = value;
            minArg = arg;
        }
    }

    return minValue;
}
