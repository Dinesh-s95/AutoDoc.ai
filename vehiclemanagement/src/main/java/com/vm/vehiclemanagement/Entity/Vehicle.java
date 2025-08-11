package com.vm.vehiclemanagement.Entity;

import java.time.LocalDate;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

@Table(name = "vehicles")
public class Vehicle {

    @Id
    private String vin;

    @NotBlank
    private String brand;

    @NotBlank
    private String model;

    @NotBlank
    private String country;

    @NotBlank
    private String device;

    @NotNull
    private LocalDate sop;
    public String getVin() {
        return vin;
    }

    public void setVin(final String vin) {
        this.vin = vin;
    }

    public String getBrand() {
        return brand;
    }

    public void setBrand(final String brand) {
        this.brand = brand;
    }

    public String getModel() {
        return model;
    }

    public void setModel(final String model) {
        this.model = model;
    }

    public String getCountry() {
        return country;
    }

    public void setCountry(final String country) {
        this.country = country;
    }

    public String getDevice() {
        return device;
    }

    public void setDevice(final String device) {
        this.device = device;
    }

    public LocalDate getSop() {
        return sop;
    }

    public void setSop(final LocalDate sop) {
        this.sop = sop;
    }






}
