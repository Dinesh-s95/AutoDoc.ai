package com.vm.usermanagement;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.openfeign.EnableFeignClients;

@SpringBootApplication
@EnableFeignClients(basePackages = "com.vm.usermanagement.client")
public class UsermanagementApplication {
	public static void main(String[] args) {
		SpringApplication.run(UsermanagementApplication.class, args);
	}
}
