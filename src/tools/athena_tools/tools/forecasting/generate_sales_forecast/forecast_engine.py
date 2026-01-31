#!/usr/bin/env python3
"""
Sales Forecasting Engine - In-Memory Implementation
Implements 7 forecasting methods without Spark/Glue dependencies
"""

import json
import sys
import numpy as np
import pandas as pd
from typing import Dict, List, Optional, Tuple
from datetime import datetime
from dateutil.relativedelta import relativedelta


def calculate_seasonality(df: pd.DataFrame) -> Tuple[pd.DataFrame, Dict[int, float]]:
    """Calculate learned seasonality indices from historical data."""
    if len(df) < 12:
        # Not enough data for seasonality - return flat pattern
        seasonal_indices = {m: 1.0 for m in range(1, 13)}
        df['month_of_year'] = pd.to_datetime(df['period'] + '-01').dt.month
        df['seasonal_index'] = df['month_of_year'].map(seasonal_indices)
        df['deseason_units'] = df['units_sold']
        return df, seasonal_indices
    
    # Calculate 12-month moving average
    df['units_ma12'] = df['units_sold'].rolling(window=12, min_periods=1).mean()
    
    # Calculate ratio to moving average
    df['ratio_ma12'] = np.where(
        df['units_ma12'] > 0,
        df['units_sold'] / df['units_ma12'],
        None
    )
    
    # Extract month from period
    df['month_of_year'] = pd.to_datetime(df['period'] + '-01').dt.month
    
    # Group by month to get average seasonal index
    seasonal_raw = df.groupby('month_of_year')['ratio_ma12'].mean()
    
    # Normalize so average = 1.0
    seasonal_avg = seasonal_raw.mean()
    if seasonal_avg > 0:
        seasonal_indices = (seasonal_raw / seasonal_avg).to_dict()
    else:
        seasonal_indices = {m: 1.0 for m in range(1, 13)}
    
    # Fill missing months with 1.0
    for m in range(1, 13):
        if m not in seasonal_indices or pd.isna(seasonal_indices[m]):
            seasonal_indices[m] = 1.0
    
    # Add seasonal index to dataframe
    df['seasonal_index'] = df['month_of_year'].map(seasonal_indices)
    
    # Calculate deseasoned units
    df['deseason_units'] = np.where(
        df['seasonal_index'] > 0,
        df['units_sold'] / df['seasonal_index'],
        df['units_sold']
    )
    
    return df, seasonal_indices


def apply_manual_seasonality(seasonality_pattern: str) -> Dict[int, float]:
    """Parse manual seasonality pattern string."""
    values = seasonality_pattern.split(';')
    if len(values) != 12:
        raise ValueError(f"Seasonality pattern must have 12 values, got {len(values)}")
    
    return {i + 1: float(v) for i, v in enumerate(values)}


def forecast_seasonal_naive(df: pd.DataFrame, horizon: int, seasonal_indices: Dict[int, float], 
                            start_period: str) -> pd.DataFrame:
    """Last month's deseasoned units × seasonality."""
    last_deseason = df.iloc[-1]['deseason_units']
    last_price = df.iloc[-1]['price']
    
    start_dt = datetime.strptime(start_period + '-01', '%Y-%m-%d')
    
    forecasts = []
    for k in range(horizon):
        forecast_dt = start_dt + relativedelta(months=k)
        forecast_period = forecast_dt.strftime('%Y-%m')
        month = forecast_dt.month
        
        seasonal_factor = seasonal_indices.get(month, 1.0)
        units = last_deseason * seasonal_factor
        
        forecasts.append({
            'forecast_period': forecast_period,
            'units_sold': round(units, 2),
            'sales_amount': round(units * last_price, 2)
        })
    
    return pd.DataFrame(forecasts)


def forecast_moving_avg_12(df: pd.DataFrame, horizon: int, seasonal_indices: Dict[int, float],
                           start_period: str) -> pd.DataFrame:
    """12-month moving average × seasonality."""
    if len(df) < 12:
        # Fall back to last 3 months average
        recent_avg = df.tail(min(3, len(df)))['deseason_units'].mean()
    else:
        recent_avg = df.tail(12)['deseason_units'].mean()
    
    last_price = df.iloc[-1]['price']
    start_dt = datetime.strptime(start_period + '-01', '%Y-%m-%d')
    
    forecasts = []
    for k in range(horizon):
        forecast_dt = start_dt + relativedelta(months=k)
        forecast_period = forecast_dt.strftime('%Y-%m')
        month = forecast_dt.month
        
        seasonal_factor = seasonal_indices.get(month, 1.0)
        units = recent_avg * seasonal_factor
        
        forecasts.append({
            'forecast_period': forecast_period,
            'units_sold': round(units, 2),
            'sales_amount': round(units * last_price, 2)
        })
    
    return pd.DataFrame(forecasts)


def forecast_trend_seasonal(df: pd.DataFrame, horizon: int, seasonal_indices: Dict[int, float],
                            start_period: str) -> pd.DataFrame:
    """Linear regression trend × seasonality."""
    # Create month index (0, 1, 2, ...)
    df['month_idx'] = range(len(df))
    
    # Fit linear regression on deseasoned data
    x = df['month_idx'].values
    y = df['deseason_units'].values
    
    # Calculate slope and intercept
    n = len(x)
    x_mean = x.mean()
    y_mean = y.mean()
    
    numerator = ((x - x_mean) * (y - y_mean)).sum()
    denominator = ((x - x_mean) ** 2).sum()
    
    if denominator > 0:
        slope = numerator / denominator
        intercept = y_mean - slope * x_mean
    else:
        slope = 0
        intercept = y_mean
    
    last_month_idx = df.iloc[-1]['month_idx']
    last_price = df.iloc[-1]['price']
    start_dt = datetime.strptime(start_period + '-01', '%Y-%m-%d')
    
    forecasts = []
    for k in range(horizon):
        forecast_dt = start_dt + relativedelta(months=k)
        forecast_period = forecast_dt.strftime('%Y-%m')
        month = forecast_dt.month
        
        # Project trend forward
        future_idx = last_month_idx + k + 1
        trend_value = max(0, intercept + slope * future_idx)
        
        seasonal_factor = seasonal_indices.get(month, 1.0)
        units = trend_value * seasonal_factor
        
        forecasts.append({
            'forecast_period': forecast_period,
            'units_sold': round(units, 2),
            'sales_amount': round(units * last_price, 2)
        })
    
    return pd.DataFrame(forecasts)


def forecast_robust_low(df: pd.DataFrame, horizon: int, seasonal_indices: Dict[int, float],
                       start_period: str) -> pd.DataFrame:
    """Conservative blend: 70% MA12 + 30% seasonal naive."""
    # Get both components
    naive_fc = forecast_seasonal_naive(df, horizon, seasonal_indices, start_period)
    ma12_fc = forecast_moving_avg_12(df, horizon, seasonal_indices, start_period)
    
    forecasts = []
    for i in range(horizon):
        forecasts.append({
            'forecast_period': naive_fc.iloc[i]['forecast_period'],
            'units_sold': round(0.7 * ma12_fc.iloc[i]['units_sold'] + 0.3 * naive_fc.iloc[i]['units_sold'], 2),
            'sales_amount': round(0.7 * ma12_fc.iloc[i]['sales_amount'] + 0.3 * naive_fc.iloc[i]['sales_amount'], 2)
        })
    
    return pd.DataFrame(forecasts)


def forecast_availability_plan(df: pd.DataFrame, horizon: int, seasonal_indices: Dict[int, float],
                               start_period: str, annual_growth: float = 0.30) -> pd.DataFrame:
    """Compound growth model."""
    # Use last 3 months average as anchor
    recent_window = min(3, len(df))
    anchor_units = df.tail(recent_window)['deseason_units'].mean()
    anchor_price = df.tail(recent_window)['price'].mean()
    
    # Check if declining trend
    if len(df) >= 3:
        last_month_units = df.iloc[-1]['deseason_units']
        recent_avg = df.tail(3)['deseason_units'].mean()
        is_declining = last_month_units < recent_avg
    else:
        is_declining = False
    
    # Apply growth floor if declining
    growth_floor = 0.05
    effective_growth = max(annual_growth, growth_floor) if is_declining else annual_growth
    
    # Monthly growth rate
    monthly_growth = (1 + effective_growth) ** (1/12) - 1
    
    start_dt = datetime.strptime(start_period + '-01', '%Y-%m-%d')
    
    forecasts = []
    for k in range(horizon):
        forecast_dt = start_dt + relativedelta(months=k)
        forecast_period = forecast_dt.strftime('%Y-%m')
        month = forecast_dt.month
        
        # Apply compound growth
        units_plan = anchor_units * ((1 + monthly_growth) ** (k + 1))
        
        seasonal_factor = seasonal_indices.get(month, 1.0)
        units = max(0, units_plan * seasonal_factor)
        
        forecasts.append({
            'forecast_period': forecast_period,
            'units_sold': round(units, 2),
            'sales_amount': round(units * anchor_price, 2)
        })
    
    return pd.DataFrame(forecasts)


def forecast_rwlt_monthly(df: pd.DataFrame, horizon: int, seasonal_indices: Dict[int, float],
                          start_period: str, alpha: float = 0.97) -> pd.DataFrame:
    """Recency-Weighted Linear Trend (monthly) - DEFAULT METHOD."""
    # Calculate daily rate for each month
    df['period_dt'] = pd.to_datetime(df['period'] + '-01')
    df['days_in_month'] = df['period_dt'].dt.days_in_month
    df['daily_rate'] = df['deseason_units'] / df['days_in_month']
    
    # Calculate age in days from last period
    last_date = df['period_dt'].iloc[-1]
    df['age_days'] = (last_date - df['period_dt']).dt.days
    
    # Use last 6 months for stability
    window_months = min(6, len(df))
    recent_df = df.tail(window_months).copy()
    
    # Apply exponential weights
    recent_df['w'] = alpha ** recent_df['age_days']
    
    # Epoch date for x-axis
    epoch_date = pd.to_datetime('2020-01-01')
    recent_df['x'] = (recent_df['period_dt'] - epoch_date).dt.days.astype(float)
    recent_df['y'] = recent_df['daily_rate']
    
    # Weighted linear regression
    sum_w = recent_df['w'].sum()
    sum_wx = (recent_df['w'] * recent_df['x']).sum()
    sum_wy = (recent_df['w'] * recent_df['y']).sum()
    sum_wxx = (recent_df['w'] * recent_df['x'] * recent_df['x']).sum()
    sum_wxy = (recent_df['w'] * recent_df['x'] * recent_df['y']).sum()
    
    if sum_w > 0:
        x_bar = sum_wx / sum_w
        y_bar = sum_wy / sum_w
        var_x = (sum_wxx / sum_w) - (x_bar ** 2)
        cov_xy = (sum_wxy / sum_w) - (x_bar * y_bar)
        
        if var_x > 0:
            slope = cov_xy / var_x
            # Soften negative slopes
            if slope < 0:
                slope = slope * 0.5
        else:
            slope = 0
        
        intercept = y_bar - slope * x_bar
    else:
        slope = 0
        intercept = recent_df['daily_rate'].mean()
    
    last_price = df.iloc[-1]['price']
    start_dt = datetime.strptime(start_period + '-01', '%Y-%m-%d')
    
    forecasts = []
    for k in range(horizon):
        forecast_dt = start_dt + relativedelta(months=k)
        forecast_period = forecast_dt.strftime('%Y-%m')
        month = forecast_dt.month
        
        # Project daily rate
        x_f = (forecast_dt - epoch_date).days
        r_hat = max(0, intercept + slope * x_f)
        
        # Convert to monthly units
        days_in_period = (forecast_dt + relativedelta(months=1) - relativedelta(days=1)).day
        units_base = r_hat * days_in_period
        
        seasonal_factor = seasonal_indices.get(month, 1.0)
        units = units_base * seasonal_factor
        
        forecasts.append({
            'forecast_period': forecast_period,
            'units_sold': round(units, 2),
            'sales_amount': round(units * last_price, 2)
        })
    
    return pd.DataFrame(forecasts)


def generate_forecasts(input_data: Dict) -> Dict:
    """Main entry point for forecast generation."""
    try:
        # Parse input
        historical_data = input_data['historical_data']
        config = input_data.get('forecast_config', {})
        metadata = input_data.get('item_metadata', {})
        
        # Create DataFrame
        df = pd.DataFrame(historical_data)
        df = df.sort_values('period')
        
        # Ensure sales_amount exists (default to 0 if missing)
        if 'sales_amount' not in df.columns:
            df['sales_amount'] = 0
        
        # Calculate price if not provided
        if 'price' in df.columns:
            df['price'] = df['price']
        else:
            df['price'] = df['sales_amount'] / df['units_sold'].replace(0, np.nan)
        df['price'] = df['price'].ffill().bfill().fillna(0)
        
        # Get configuration
        methods = config.get('methods', ['rwlt_monthly_plan'])
        if not methods:
            methods = ['rwlt_monthly_plan']
        
        horizon = config.get('horizon_months', 12)
        start_period = config.get('start_period')
        
        if not start_period:
            last_period_dt = datetime.strptime(df.iloc[-1]['period'] + '-01', '%Y-%m-%d')
            start_period = (last_period_dt + relativedelta(months=1)).strftime('%Y-%m')
        
        # Handle seasonality
        seasonality_pattern = config.get('seasonality_pattern')
        if seasonality_pattern:
            seasonal_indices = apply_manual_seasonality(seasonality_pattern)
            df['seasonal_index'] = pd.to_datetime(df['period'] + '-01').dt.month.map(seasonal_indices)
            df['deseason_units'] = df['units_sold'] / df['seasonal_index']
        else:
            df, seasonal_indices = calculate_seasonality(df)
        
        # Generate forecasts for each method
        results = []
        
        method_functions = {
            'seasonal_naive': forecast_seasonal_naive,
            'moving_avg_12': forecast_moving_avg_12,
            'trend_seasonal': forecast_trend_seasonal,
            'robust_low': forecast_robust_low,
            'availability_plan': lambda df, h, si, sp: forecast_availability_plan(
                df, h, si, sp, config.get('availability_growth_annual', 0.30)
            ),
            'rwlt_monthly_plan': forecast_rwlt_monthly,
            'rwlt_plan': forecast_rwlt_monthly,  # Alias
        }
        
        for method in methods:
            if method not in method_functions:
                continue
            
            forecast_df = method_functions[method](df, horizon, seasonal_indices, start_period)
            
            results.append({
                'method': method,
                'forecast_periods': forecast_df.to_dict('records')
            })
        
        return {
            'success': True,
            'forecasts': results,
            'metadata': metadata,
            'seasonality_indices': seasonal_indices
        }
    
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'error_type': type(e).__name__
        }


if __name__ == '__main__':
    # Read input from stdin
    input_json = sys.stdin.read()
    input_data = json.loads(input_json)
    
    # Generate forecasts
    result = generate_forecasts(input_data)
    
    # Output result as JSON
    print(json.dumps(result, indent=2))
